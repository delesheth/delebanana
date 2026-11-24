// Video người dùng tải lên (provider manual): ghi luồng ra đĩa có giới hạn 200 MB, đọc metadata bằng ffprobe của máy, kiểm theo
// nơi tạo video rồi ghi phiên bản; và phục vụ tệp có Range (Safari cần 206 mới phát được). Không dùng base64/JSON như ảnh.

import { MAX_VIDEO_BYTES, VIDEO_MIME_TYPES, checkVideoFile, parseFfprobe, videoToolById, type VideoCheck, type VideoProbe } from '@delebanana/domain';
import { eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Hono } from 'hono';
import { ApprovalError, checkVideoUploadAllowed, recordVideoUpload } from '../campaign/engine.ts';
import { runTx, type Deps } from '../core/unitOfWork.ts';
import { videoVersions } from '../db/schema.ts';
import { newId } from '../ids.ts';

export const FFPROBE_MISSING_MESSAGE = 'Chưa cài ffprobe. Cài bằng `brew install ffmpeg` rồi tải lại.';
const FFPROBE_TIMEOUT_MS = 20_000;

/** Không tìm thấy ffprobe trong PATH. */
export class FfprobeMissing extends Error {
  constructor() {
    super(FFPROBE_MISSING_MESSAGE);
  }
}
/** ffprobe chạy được nhưng không đọc được tệp (hỏng, không phải video). */
export class VideoUnreadable extends Error {}
/** ffprobe không chạy xong (hết giờ, lỗi spawn/quyền, vượt maxBuffer): lỗi của công cụ, không phải của tệp. */
export class FfprobeFailed extends Error {
  readonly timedOut: boolean;
  constructor(timedOut: boolean, detail: string) {
    super(timedOut ? 'ffprobe chạy quá lâu nên đã bị dừng. Thử tải lại.' : `ffprobe gặp lỗi khi chạy (không phải do tệp): ${detail}`);
    this.timedOut = timedOut;
  }
}

/** Phân loại lỗi của execFile: ENOENT → thiếu ffprobe; bị dừng/lỗi chạy (code chuỗi) → FfprobeFailed; chỉ exit code số ≠ 0 mới là tệp không đọc được. */
export function classifyFfprobeError(err: { code?: unknown; killed?: boolean; signal?: unknown; message?: string }): Error {
  if (err.killed || err.signal) return new FfprobeFailed(true, err.message ?? '');
  if (err.code === 'ENOENT') return new FfprobeMissing();
  if (typeof err.code === 'number') return new VideoUnreadable(err.message ?? '');
  return new FfprobeFailed(false, err.message ?? String(err.code));
}

/** Đọc metadata của một tệp video; tách riêng để kiểm thử giả lập mà không cần ffprobe thật. */
export type ProbeFn = (file: string) => Promise<VideoProbe>;

export const probeVideo: ProbeFn = (file) =>
  new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(classifyFfprobeError(err));
      try {
        resolve(parseFfprobe(JSON.parse(stdout)));
      } catch {
        reject(new VideoUnreadable('ffprobe trả kết quả không đọc được'));
      }
    });
  });

export class UploadTooLarge extends Error {}

class TooLarge extends Error {}

/** Ghi luồng vào `file`, huỷ và xoá tệp dở nếu vượt `limit` byte; trả số byte đã ghi. */
async function saveStream(body: ReadableStream<Uint8Array>, file: string, limit: number): Promise<number> {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > limit) cb(new TooLarge());
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(file));
  } catch (e) {
    rmSync(file, { force: true });
    if (e instanceof TooLarge) throw new UploadTooLarge();
    throw e;
  }
  return size;
}

export const tooLargeMessage = (limit: number) => `Tệp quá lớn (tối đa ${limit >= 1048576 ? `${limit / 1048576} MB` : `${limit} byte`})`;
export const TOO_LARGE_MESSAGE = tooLargeMessage(MAX_VIDEO_BYTES);
const UNREADABLE_REASON = 'Không đọc được tệp video (tệp hỏng hoặc không phải video MP4/MOV)';

export interface VideoRouteOptions {
  videoDir?: string;
  probe?: ProbeFn;
  /** Giới hạn dung lượng tệp (mặc định MAX_VIDEO_BYTES); tiêm được để kiểm thử 413 không cần ghi hàng trăm MB. */
  maxBytes?: number;
}

export function mountVideos(app: Hono, deps: Deps, opts: VideoRouteOptions): void {
  const { db } = deps;
  const probe = opts.probe ?? probeVideo;
  const maxBytes = opts.maxBytes ?? MAX_VIDEO_BYTES;
  const tooLarge = tooLargeMessage(maxBytes);

  app.post('/videos/:approvalId/upload', async (c) => {
    const dir = opts.videoDir;
    if (!dir) return c.json({ error: 'Server không bật tải video' }, 503);
    const approvalId = c.req.param('approvalId');
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(VIDEO_MIME_TYPES as readonly string[]).includes(mime)) return c.json({ error: 'Content-Type phải là video/mp4 hoặc video/quicktime' }, 415);
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return c.json({ error: tooLarge }, 413);
    // Kiểm trước khi đọc thân: Approval còn mở, không đang có bản chờ duyệt (409 sớm, không tốn đĩa).
    const target = checkVideoUploadAllowed(db, approvalId);
    const tool = videoToolById(target.toolId);
    if (!tool) throw new ApprovalError(400, `Nơi tạo video không còn trong cấu hình: ${target.toolId}`);
    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'Thiếu nội dung tệp video' }, 400);

    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${newId()}.part`);
    try {
      let size: number;
      try {
        size = await saveStream(body, tmp, maxBytes);
      } catch (e) {
        if (e instanceof UploadTooLarge) return c.json({ error: tooLarge }, 413);
        throw e;
      }
      if (size === 0) return c.json({ error: 'Tệp video trống' }, 400);

      let meta: VideoProbe = {};
      let check: VideoCheck;
      try {
        meta = await probe(tmp);
        check = checkVideoFile(tool, meta, size);
      } catch (e) {
        if (e instanceof FfprobeMissing) return c.json({ error: FFPROBE_MISSING_MESSAGE }, 503);
        if (e instanceof FfprobeFailed) return c.json({ error: e.message }, e.timedOut ? 503 : 500);
        if (!(e instanceof VideoUnreadable)) throw e;
        check = { status: 'invalid', reasons: [UNREADABLE_REASON] };
      }
      // Đổi tên tệp nằm trong giao dịch: lỗi đổi tên thì phiên bản cũng không được ghi.
      const r = runTx(deps, (u) => {
        const res = recordVideoUpload(u, approvalId, { mime, sizeBytes: size, probe: meta, check });
        if (res.filename) renameSync(tmp, join(dir, res.filename));
        return res;
      });
      return c.json({ versionId: r.versionId, number: r.number, status: r.status, reasons: r.reasons }, 201);
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  app.get('/videos/:versionId/file', (c) => {
    const v = db.select().from(videoVersions).where(eq(videoVersions.id, c.req.param('versionId'))).get();
    const file = v?.path && opts.videoDir ? join(opts.videoDir, basename(v.path)) : undefined;
    if (!v || !file || !existsSync(file)) return c.json({ error: 'Không có video' }, 404);
    const size = statSync(file).size;
    const headers: Record<string, string> = { 'Content-Type': v.mime ?? 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (c.req.query('download') === '1') headers['Content-Disposition'] = `attachment; filename="video-${v.number}${basename(file).slice(basename(file).lastIndexOf('.'))}"`;
    const range = c.req.header('range');
    if (!range) return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
    // Một khoảng duy nhất: bytes=a-b, bytes=a-, bytes=-n.
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m?.[1] ? Number(m[1]) : NaN;
    let end = m?.[2] ? Number(m[2]) : NaN;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else if (m && m[1] && !m[2]) end = size - 1;
    if (!m || Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    end = Math.min(end, size - 1);
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  });
}
