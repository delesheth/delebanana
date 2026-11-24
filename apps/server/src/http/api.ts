// API JSON cho luồng Campaign (spec phần 3). Chỉ phục vụ trên 127.0.0.1 (server không nghe địa chỉ khác).

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { LatestVideo, MessageAttachment } from '@delebanana/domain';
import type { Context, Hono } from 'hono';
import type { Gateway } from '../agents/gateway.ts';
import { unblockProvider } from '../agents/usage.ts';
import { decideApproval } from '../campaign/approvals.ts';
import { ApprovalError, createCampaign, deleteCampaign, latestVideoVersion, openBriefing } from '../campaign/engine.ts';
import { publishApprovalView } from '../campaign/publishing.ts';
import { runTx, type Deps } from '../core/unitOfWork.ts';
import { approvals, artifacts, campaignStages, campaigns, conversations, messages, providerStatus, tasks, videoVersions, workspaces } from '../db/schema.ts';
import { newId } from '../ids.ts';
import { findUpload, readUpload, saveUpload, uploadPath, UploadError } from './uploads.ts';

class BadRequest extends Error {}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    // rơi xuống lỗi dưới
  }
  throw new BadRequest('Nội dung phải là JSON object');
}

const MAX_ATTACHMENTS = 6;

export function mountApi(app: Hono, deps: Deps, gateway?: Gateway, uploadDir?: string, videoDir?: string): void {
  const { db } = deps;
  const workspaceOf = (c: Context) => c.req.query('workspaceId') ?? db.select({ id: workspaces.id }).from(workspaces).where(isNull(workspaces.archivedAt)).get()?.id;
  const directorConversation = (workspaceId: string) =>
    db.select().from(conversations).where(and(eq(conversations.workspaceId, workspaceId), isNull(conversations.agentId))).get();

  app.onError((err, c) => {
    if (err instanceof BadRequest || err instanceof UploadError) return c.json({ error: err.message }, 400);
    if (err instanceof ApprovalError) return c.json({ error: err.message }, err.code);
    console.error(err);
    return c.json({ error: 'Lỗi máy chủ' }, 500);
  });

  app.get('/campaigns', (c) => c.json(db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).all()));

  app.post('/campaigns', async (c) => {
    const b = await body(c);
    const title = String(b.title ?? '').trim();
    if (!title) throw new BadRequest('Cần tiêu đề');
    const workspaceId = String(b.workspaceId ?? workspaceOf(c) ?? '');
    if (!db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()) throw new BadRequest('Không có Workspace');
    const id = runTx(deps, (u) => {
      const id = createCampaign(u, workspaceId, title);
      openBriefing(u, id);
      return id;
    });
    return c.json({ id }, 201);
  });

  app.get('/campaigns/:id', (c) => {
    const id = c.req.param('id');
    const campaign = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
    if (!campaign) return c.json({ error: 'Không có chiến dịch' }, 404);
    return c.json({
      campaign,
      stages: db.select().from(campaignStages).where(eq(campaignStages.campaignId, id)).all(),
      tasks: db.select().from(tasks).where(eq(tasks.campaignId, id)).orderBy(asc(tasks.createdAt)).all(),
      artifacts: db.select().from(artifacts).where(eq(artifacts.campaignId, id)).orderBy(asc(artifacts.createdAt)).all(),
      approvals: db.select().from(approvals).where(eq(approvals.campaignId, id)).all(),
    });
  });

  app.get('/tasks/:id', (c) => {
    const task = db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).get();
    if (!task) return c.json({ error: 'Không có task' }, 404);
    const campaign = db.select({ title: campaigns.title }).from(campaigns).where(eq(campaigns.id, task.campaignId)).get();
    return c.json({ task, campaignTitle: campaign?.title ?? '' });
  });

  app.delete('/campaigns/:id', (c) => {
    const files = runTx(deps, (u) => deleteCampaign(u, c.req.param('id')));
    // Sau commit: tệp không còn dòng nào trỏ tới. Lỗi xoá tệp không làm hỏng việc xoá chiến dịch.
    if (videoDir) for (const f of files) rmSync(join(videoDir, basename(f)), { force: true });
    return c.json({ ok: true });
  });

  /** Chat Director luôn gắn một chiến dịch của Workspace; thiếu hoặc sai → 400. */
  const requireCampaign = (workspaceId: string, raw: unknown): string => {
    const campaignId = raw ? String(raw) : '';
    if (!campaignId) throw new BadRequest('Thiếu campaignId');
    if (db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId))).get() === undefined) {
      throw new BadRequest('Chiến dịch không tồn tại trong Workspace');
    }
    return campaignId;
  };

  app.get('/conversations/director/messages', (c) => {
    const ws = workspaceOf(c);
    if (!ws) return c.json([]);
    const campaignId = requireCampaign(ws, c.req.query('campaignId'));
    const conv = directorConversation(ws);
    if (!conv) return c.json([]);
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    return c.json(db.select().from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.campaignId, campaignId))).orderBy(desc(messages.createdAt)).limit(limit).all().reverse());
  });

  /** Tin hệ thống không gắn chiến dịch (vd. hạn mức gói) gần đây: web nạp vào chuông khi mở trang, vì sự kiện trực tiếp mất khi không mở tab. */
  app.get('/notices/system', (c) => {
    const ws = workspaceOf(c);
    const conv = ws ? directorConversation(ws) : undefined;
    if (!conv) return c.json([]);
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 50);
    return c.json(
      db
        .select({ id: messages.id, content: messages.content, createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.conversationId, conv.id), eq(messages.role, 'system'), isNull(messages.campaignId)))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit)
        .all(),
    );
  });

  app.post('/conversations/director/messages', async (c) => {
    const b = await body(c);
    const content = String(b.content ?? '').trim();
    const attachments = parseAttachments(b.attachments);
    if (!content && attachments.length === 0) throw new BadRequest('Tin nhắn trống');
    const ws = workspaceOf(c);
    const conv = ws ? directorConversation(ws) : undefined;
    if (!conv) throw new BadRequest('Không có hội thoại Director');
    const campaignId = requireCampaign(conv.workspaceId, b.campaignId);
    const id = runTx(deps, (u) => {
      const mid = newId();
      u.tx.insert(messages).values({ id: mid, conversationId: conv.id, role: 'user', campaignId, content, attachments: attachments.length ? attachments : null, kind: 'chat', createdAt: u.now }).run();
      u.emit({ type: 'message.created', workspaceId: conv.workspaceId, campaignId, entity: { kind: 'message', id: mid }, actor: 'user', data: { conversationId: conv.id, role: 'user' } });
      return mid;
    });
    return c.json({ id }, 201);
  });

  /** Chỉ nhận ảnh đã tải lên qua POST /uploads (có tệp thật trong thư mục uploads). */
  function parseAttachments(raw: unknown): MessageAttachment[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new BadRequest('attachments phải là mảng');
    if (raw.length > MAX_ATTACHMENTS) throw new BadRequest(`Tối đa ${MAX_ATTACHMENTS} ảnh mỗi tin`);
    return raw.map((r) => {
      const a = { id: String((r as MessageAttachment)?.id ?? ''), name: String((r as MessageAttachment)?.name ?? ''), mime: String((r as MessageAttachment)?.mime ?? '') };
      if (!uploadDir || !uploadPath(uploadDir, a)) throw new BadRequest('Ảnh đính kèm không tồn tại');
      return a;
    });
  }

  app.post('/uploads', async (c) => {
    if (!uploadDir) return c.json({ error: 'Server không bật tải ảnh' }, 503);
    const b = await body(c);
    return c.json(saveUpload(uploadDir, { name: b.name, mime: b.mime, data: b.data }), 201);
  });

  app.get('/uploads/:id', (c) => {
    const found = uploadDir ? findUpload(uploadDir, c.req.param('id')) : undefined;
    if (!found) return c.json({ error: 'Không có ảnh' }, 404);
    return c.body(readUpload(found.file), 200, { 'Content-Type': found.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  });

  const latestVideo = (v: typeof videoVersions.$inferSelect | undefined): LatestVideo | null =>
    v ? { id: v.id, number: v.number, status: v.status as LatestVideo['status'], invalidReasons: v.invalidReasons, sizeBytes: v.sizeBytes, mime: v.mime } : null;
  const withArtifacts = <T extends object>(a: T, s: { kind?: unknown; ids?: unknown }) => {
    if (s.kind !== 'artifact' || !Array.isArray(s.ids) || s.ids.length === 0) return a;
    const ids = s.ids.map(String);
    const found = db.select({ id: artifacts.id, kind: artifacts.kind, content: artifacts.content }).from(artifacts).where(inArray(artifacts.id, ids)).all();
    return { ...a, artifacts: ids.flatMap((id) => found.filter((f) => f.id === id)) };
  };

  // Approval chọn artifact (vd. chọn kịch bản) kèm nội dung artifact để người dùng đọc được thay vì chỉ thấy mã.
  app.get('/approvals', (c) => {
    const status = c.req.query('status');
    const q = db.select().from(approvals);
    const rows = (status ? q.where(eq(approvals.status, status)) : q).orderBy(desc(approvals.createdAt)).all();
    return c.json(
      rows.map((a) => {
        const s = a.subject as { kind?: unknown; ids?: unknown };
        if (a.kind === 'choose_script' && a.campaignId) {
          // Cờ cho nút "Tạo video": chỉ dùng được khi bước video của chiến dịch còn `pending`.
          const video = db.select({ status: campaignStages.status }).from(campaignStages).where(and(eq(campaignStages.campaignId, a.campaignId), eq(campaignStages.stage, 'video'))).get();
          return { ...withArtifacts(a, s), videoAvailable: video?.status === 'pending' };
        }
        if (a.kind === 'make_video') return { ...withArtifacts(a, s), latestVideo: latestVideo(latestVideoVersion(db, a.id)) };
        if (a.kind === 'approve_video' && Array.isArray(s.ids)) {
          const v = db.select().from(videoVersions).where(eq(videoVersions.id, String(s.ids[0]))).get();
          return { ...a, latestVideo: latestVideo(v) };
        }
        if (a.kind === 'approve_publish') return { ...a, ...publishApprovalView(db, a, deps.clock?.() ?? Date.now()) };
        return withArtifacts(a, s);
      }),
    );
  });

  app.post('/approvals/:id/decide', async (c) => {
    const b = await body(c);
    return c.json(decideApproval(deps, gateway, c.req.param('id'), { status: String(b.status ?? ''), decision: (b.decision as Record<string, unknown>) ?? {} }));
  });

  app.get('/providers', (c) =>
    c.json(
      db
        .select({
          provider: providerStatus.provider,
          blockedUntil: providerStatus.blockedUntil,
          blockReason: providerStatus.blockReason,
          utilization5h: providerStatus.utilization5h,
          utilization7d: providerStatus.utilization7d,
          resetsAt: providerStatus.resetsAt,
        })
        .from(providerStatus)
        .orderBy(asc(providerStatus.provider))
        .all(),
    ),
  );

  app.post('/providers/:provider/unblock', (c) => {
    const provider = c.req.param('provider');
    const ws = workspaceOf(c) ?? '';
    runTx(deps, (u) => {
      unblockProvider(u, provider);
      u.audit({ workspaceId: ws, actor: 'user', action: 'user.provider.unblock', target: { kind: 'provider', id: provider }, result: 'allowed' });
    });
    return c.json({ ok: true });
  });
}
