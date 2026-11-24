// HTTP của backend phần 1: /health, /snapshot, /events (SSE, TK2 mục 6.3).

import { VIDEO_MIME_TYPES, type DomainEvent } from '@delebanana/domain';
import { asc, gt, min } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { lastSeq, snapshot } from '../core/snapshot.ts';
import type { Deps } from '../core/unitOfWork.ts';
import type { Gateway } from '../agents/gateway.ts';
import { mountApi } from './api.ts';
import { mountVideos, type ProbeFn } from './videos.ts';
import { mountPublish } from './publish.ts';
import { Accounts } from '../publish/accounts.ts';
import { createMetaClient } from '../publish/meta.ts';
import { events } from '../db/schema.ts';

const PING_MS = 25_000;

type EventRow = typeof events.$inferSelect;
function toDomain(r: EventRow): DomainEvent {
  return {
    seq: r.seq,
    at: r.at,
    type: r.type,
    workspaceId: r.workspaceId,
    ...(r.campaignId ? { campaignId: r.campaignId } : {}),
    entity: { kind: r.entityKind, id: r.entityId },
    actor: r.actor,
    data: r.data,
  } as DomainEvent;
}

export interface AppOptions {
  gateway?: Gateway;
  uploadDir?: string;
  /** Thư mục lưu video người dùng tải lên; thiếu thì tải video trả 503. */
  videoDir?: string;
  /** Bộ đọc metadata video (mặc định ffprobe của máy); tiêm được để kiểm thử. */
  probe?: ProbeFn;
  /** Giới hạn dung lượng video tải lên (mặc định 200 MB); tiêm được để kiểm thử. */
  maxBytes?: number;
  /** Kết nối tài khoản xã hội (dùng chung với worker đăng bài); thiếu thì tạo mới với client Meta thật. */
  accounts?: Accounts;
  /** Cổng server, dùng dựng redirect OAuth `http://localhost:<cổng>/oauth/facebook/callback`. */
  port?: number;
  /** Có thì bật POST /shutdown (nút Stop trên giao diện): gọi sau khi đã trả lời. */
  onShutdown?: () => void;
}

export function createApp(deps: Deps, opts: AppOptions = {}): Hono {
  const { db, bus } = deps;
  const app = new Hono();

  // Chỉ phục vụ chính máy người dùng: chặn DNS rebinding (Host lạ) và trang web khác gửi yêu cầu (CSRF) — một trang lạ
  // không được tự gửi tin cho Director để đốt hạn mức gói thuê bao (D-14).
  const UPLOAD_PATH = /^\/videos\/[^/]+\/upload$/;
  const VIDEO_TYPES = new Set<string>(VIDEO_MIME_TYPES);
  const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);
  app.use('*', async (c, next) => {
    if (!LOCAL.has(new URL(c.req.url).hostname)) return c.json({ error: 'Chỉ phục vụ trên máy này' }, 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).hostname;
        } catch {
          // Origin không đọc được → coi là lạ
        }
        if (!LOCAL.has(host)) return c.json({ error: 'Nguồn gửi không được phép' }, 403);
      }
      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      // Ngoại lệ hẹp: đúng route tải video nhận thân thô video/mp4|quicktime. Đây là Content-Type không "simple" nên trang lạ
      // vẫn phải qua preflight (bị chặn) — ngang mức an toàn của application/json. multipart/form-data thì không được phép.
      if (UPLOAD_PATH.test(new URL(c.req.url).pathname)) {
        if (!VIDEO_TYPES.has(type)) return c.json({ error: 'Cần Content-Type: video/mp4 hoặc video/quicktime' }, 415);
      } else if (!type.includes('application/json')) return c.json({ error: 'Cần Content-Type: application/json' }, 415);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));
  const onShutdown = opts.onShutdown;
  if (onShutdown) {
    app.post('/shutdown', (c) => {
      setTimeout(onShutdown, 50);
      return c.json({ ok: true });
    });
  }
  app.get('/snapshot', (c) => c.json(snapshot(db)));

  // Cổng công cụ MCP cho lượt chạy CLI (TK3 mục 4); cầu nối stdio gọi vào đây kèm token lượt chạy.
  const gateway = opts.gateway;
  if (gateway) {
    app.post('/mcp/:token', async (c) => c.json(gateway.handle(c.req.param('token'), await c.req.json()) as object));
  }

  app.get('/events', (c) => {
    // Khi trình duyệt tự nối lại, nó giữ URL cũ (?after=) và gửi Last-Event-ID mới hơn: header thắng.
    const after = Number(c.req.header('Last-Event-ID') ?? c.req.query('after') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      // Đăng ký trước khi đọc backlog để không lỡ sự kiện commit ở giữa; lọc trùng bằng `lastSent`.
      const queue: DomainEvent[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      try {
        // Gửi ngay một byte để proxy (Vite) chuyển header đi: trình duyệt báo `open` liền, không đợi ping đầu tiên.
        await stream.writeSSE({ event: 'ping', data: '' });
        const lo = db.select({ lo: min(events.seq) }).from(events).get()?.lo;
        const hi = lastSeq(db);
        if (after > hi || (lo != null && after < lo - 1)) {
          await stream.writeSSE({ event: 'resync', data: JSON.stringify({ seq: hi }) });
          return;
        }
        let lastSent = after;
        const send = async (e: DomainEvent) => {
          if (e.seq <= lastSent) return;
          await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) });
          lastSent = e.seq;
        };
        for (const r of db.select().from(events).where(gt(events.seq, after)).orderBy(asc(events.seq)).all()) await send(toDomain(r));
        while (!closed) {
          while (queue.length > 0) await send(queue.shift()!);
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, PING_MS);
          });
          wake = undefined;
          if (!closed && queue.length === 0) await stream.writeSSE({ event: 'ping', data: '' });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  mountApi(app, deps, opts.gateway, opts.uploadDir, opts.videoDir);
  mountPublish(app, deps, opts.accounts ?? new Accounts(deps, createMetaClient(), opts.port ?? 8787));
  mountVideos(app, deps, { videoDir: opts.videoDir, probe: opts.probe, maxBytes: opts.maxBytes });
  return app;
}
