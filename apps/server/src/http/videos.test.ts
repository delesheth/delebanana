import { MAX_VIDEO_BYTES, type VideoProbe } from '@delebanana/domain';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/bus.ts';
import { runTx } from '../core/unitOfWork.ts';
import { approvals, artifacts, campaignStages, campaigns, videoVersions } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { createApp } from './app.ts';
import { FFPROBE_MISSING_MESSAGE, FfprobeFailed, FfprobeMissing, VideoUnreadable, classifyFfprobeError, type ProbeFn } from './videos.ts';
import { createCampaign } from '../campaign/engine.ts';

const GOOD: VideoProbe = { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSeconds: 8, width: 720, height: 1280, codec: 'h264' };
const BYTES = Buffer.from('fake-mp4-bytes-0123456789');

function setup(probe: ProbeFn = async () => GOOD, maxBytes?: number) {
  const { db, ids } = minimal();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => ++now };
  const videoDir = join(mkdtempSync(join(tmpdir(), 'dele-video-')), 'videos');
  const app = createApp(deps, { videoDir, probe, maxBytes });
  const cid = runTx(deps, (u) => createCampaign(u, ids.workspace, 'Bông Bông'));
  db.update(campaigns).set({ status: 'active', currentStage: 'video' }).where(eq(campaigns.id, cid)).run();
  db.update(campaignStages).set({ status: 'awaiting_approval' }).where(eq(campaignStages.campaignId, cid)).run();
  db.insert(artifacts).values({ id: 'VP1', campaignId: cid, kind: 'video_prompt', content: { text: 'p' }, createdAt: T0 }).run();
  db.insert(approvals).values({ id: 'MK1', workspaceId: ids.workspace, campaignId: cid, kind: 'make_video', subject: { kind: 'artifact', ids: ['VP1'], toolId: 'gemini' }, requestedByAgentId: ids.director, status: 'pending', createdAt: T0, updatedAt: T0 }).run();
  db.insert(videoVersions).values({ id: 'VV0', campaignId: cid, videoId: 'VP1', makeVideoApprovalId: 'MK1', number: 1, provider: 'manual', toolId: 'gemini', status: 'awaiting_upload', createdAt: T0, updatedAt: T0 }).run();
  const upload = async (body: BodyInit | null = BYTES, headers: Record<string, string> = { 'content-type': 'video/mp4' }, id = 'MK1') => {
    const res = await app.request(`/videos/${id}/upload`, { method: 'POST', body, headers, ...(body && typeof body !== 'string' && !(body instanceof Uint8Array) ? { duplex: 'half' } : {}) } as RequestInit);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const json = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const files = () => (existsSync(videoDir) ? readdirSync(videoDir) : []);
  const versions = () => db.select().from(videoVersions).orderBy(videoVersions.number).all();
  return { db, ids, cid, app, videoDir, upload, json, files, versions };
}

describe('POST /videos/:id/upload', () => {
  it('thân thô video/mp4 → 201 ready: lưu tệp vào thư mục dữ liệu, phiên bản manual gắn toolId, Approval approve_video', async () => {
    const s = setup();
    const r = await s.upload();
    expect(r).toMatchObject({ status: 201, body: { number: 1, status: 'ready', reasons: [], versionId: 'VV0' } });
    expect(s.files()).toEqual(['VV0.mp4']);
    expect(readFileSync(join(s.videoDir, 'VV0.mp4'))).toEqual(BYTES);
    expect(s.versions()[0]).toMatchObject({ status: 'ready', provider: 'manual', toolId: 'gemini', path: 'VV0.mp4', mime: 'video/mp4', sizeBytes: BYTES.length });
    const av = s.db.select().from(approvals).all().find((a) => a.kind === 'approve_video')!;
    expect(av).toMatchObject({ status: 'pending', subject: { kind: 'video_version', ids: ['VV0'], makeVideoApprovalId: 'MK1' } });
  });

  it('video/quicktime → tệp .mov', async () => {
    const s = setup();
    expect((await s.upload(BYTES, { 'content-type': 'video/quicktime' })).status).toBe(201);
    expect(s.files()).toEqual(['VV0.mov']);
  });

  it('tệp sai luật → 201 invalid kèm lý do, không giữ tệp, không có approve_video; tải lại → phiên bản #2', async () => {
    let next: VideoProbe = { ...GOOD, width: 1920, height: 1080 };
    const s = setup(async () => next);
    const r = await s.upload();
    expect(r).toMatchObject({ status: 201, body: { number: 1, status: 'invalid' } });
    expect(r.body.reasons.join(' ')).toContain('tạo lại ở Gemini');
    expect(s.files()).toEqual([]);
    expect(s.versions()[0]).toMatchObject({ status: 'invalid', path: null });
    expect(s.db.select().from(approvals).all().filter((a) => a.kind === 'approve_video')).toHaveLength(0);
    next = GOOD;
    expect((await s.upload()).body).toMatchObject({ number: 2, status: 'ready' });
    expect(s.versions().map((v) => [v.number, v.status])).toEqual([[1, 'invalid'], [2, 'ready']]);
    expect(s.files()).toHaveLength(1);
  });

  it('tệp ffprobe không đọc được → invalid với lý do, không sập', async () => {
    const s = setup(async () => {
      throw new VideoUnreadable('x');
    });
    const r = await s.upload();
    expect(r.body).toMatchObject({ status: 'invalid' });
    expect(r.body.reasons[0]).toContain('Không đọc được tệp video');
    expect(s.files()).toEqual([]);
  });

  it('classifyFfprobeError: ENOENT → thiếu; killed/signal → hết giờ; code chuỗi → lỗi chạy; exit code số → tệp không đọc được', () => {
    expect(classifyFfprobeError({ code: 'ENOENT' })).toBeInstanceOf(FfprobeMissing);
    expect(classifyFfprobeError({ killed: true, signal: 'SIGTERM', code: null })).toMatchObject({ timedOut: true });
    expect(classifyFfprobeError({ signal: 'SIGKILL' })).toMatchObject({ timedOut: true });
    for (const code of ['EACCES', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']) expect(classifyFfprobeError({ code })).toMatchObject({ timedOut: false });
    expect(classifyFfprobeError({ code: 'EACCES' })).toBeInstanceOf(FfprobeFailed);
    expect(classifyFfprobeError({ code: 1, message: 'x' })).toBeInstanceOf(VideoUnreadable);
  });

  it.each([
    [true, 503],
    [false, 500],
  ])('ffprobe không chạy xong (hết giờ=%s) → %i, không ghi phiên bản, không tệp, không approve_video', async (timedOut, status) => {
    const s = setup(async () => {
      throw new FfprobeFailed(timedOut, 'EACCES');
    });
    const r = await s.upload();
    expect(r.status).toBe(status);
    expect(r.body.error).toContain('ffprobe');
    expect(r.body.error).not.toContain('hỏng');
    expect(s.versions().map((v) => [v.number, v.status])).toEqual([[1, 'awaiting_upload']]);
    expect(s.files()).toEqual([]);
    expect(s.db.select().from(approvals).all().filter((a) => a.kind === 'approve_video')).toHaveLength(0);
  });

  it('thiếu ffprobe → 503 có "brew install ffmpeg", trạng thái phiên bản không đổi, không để lại tệp, server vẫn phục vụ', async () => {
    const s = setup(async () => {
      throw new FfprobeMissing();
    });
    const r = await s.upload();
    expect(r.status).toBe(503);
    expect(r.body.error).toContain('brew install ffmpeg');
    expect(r.body.error).toBe(FFPROBE_MISSING_MESSAGE);
    expect(s.versions().map((v) => v.status)).toEqual(['awaiting_upload']);
    expect(s.files()).toEqual([]);
    expect((await s.json('GET', '/approvals?status=pending')).status).toBe(200);
  });

  it('Content-Type khác → 415 (kể cả multipart, text/plain, JSON); Origin lạ → 403; Host lạ → 403', async () => {
    const s = setup();
    for (const type of ['multipart/form-data; boundary=x', 'text/plain', 'application/json', 'application/octet-stream']) expect((await s.upload(BYTES, { 'content-type': type })).status).toBe(415);
    expect((await s.upload(BYTES, { 'content-type': 'video/mp4', origin: 'https://evil.example' })).status).toBe(403);
    expect((await s.upload(BYTES, { 'content-type': 'video/mp4', origin: 'http://localhost:5173' })).status).toBe(201);
    const res = await s.app.request('http://evil.example/videos/MK1/upload', { method: 'POST', body: BYTES, headers: { 'content-type': 'video/mp4' } });
    expect(res.status).toBe(403);
    expect(s.files().filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('route khác vẫn đòi application/json (video/mp4 không mở được cổng khác)', async () => {
    const s = setup();
    const res = await s.app.request('/campaigns', { method: 'POST', body: '{}', headers: { 'content-type': 'video/mp4' } });
    expect(res.status).toBe(415);
  });

  it('Content-Length lớn hơn 200 MB → 413 trước khi đọc, không tệp', async () => {
    const s = setup();
    const r = await s.upload(BYTES, { 'content-type': 'video/mp4', 'content-length': String(MAX_VIDEO_BYTES + 1) });
    expect(r.status).toBe(413);
    expect(r.body.error).toContain('200 MB');
    expect(s.files()).toEqual([]);
    expect(s.versions().map((v) => v.status)).toEqual(['awaiting_upload']);
  });

  it('khai báo nhỏ nhưng byte thực vượt 200 MB → 413, huỷ luồng, xoá tệp dở', async () => {
    const s = setup(undefined, 4096);
    const chunk = new Uint8Array(1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent++ > 8) return ctl.close();
        ctl.enqueue(chunk);
      },
    });
    const r = await s.upload(body);
    expect(r.status).toBe(413);
    expect(r.body.error).toContain('4096 byte');
    expect(s.files()).toEqual([]);
    expect(s.versions().map((v) => v.status)).toEqual(['awaiting_upload']);
  });

  it('đang có bản ready chờ duyệt → 409; Approval không có/không phải make_video/đã đóng → 404/400/409', async () => {
    const s = setup();
    expect((await s.upload()).status).toBe(201);
    expect((await s.upload()).status).toBe(409);
    expect(s.files()).toEqual(['VV0.mp4']);
    expect((await s.upload(BYTES, undefined, 'khong-co')).status).toBe(404);
    s.db.update(approvals).set({ status: 'expired' }).where(eq(approvals.id, 'MK1')).run();
    expect((await s.upload()).status).toBe(409);
  });

  it('thân rỗng → 400', async () => {
    const s = setup();
    expect((await s.upload(new Uint8Array(0))).status).toBe(400);
    expect(s.files()).toEqual([]);
  });

  it('không bật videoDir → 503', async () => {
    const { db, ids } = minimal();
    const app = createApp({ db, bus: new EventBus() });
    void ids;
    const res = await app.request('/videos/MK1/upload', { method: 'POST', body: BYTES, headers: { 'content-type': 'video/mp4' } });
    expect(res.status).toBe(503);
  });
});

describe('duyệt video qua HTTP', () => {
  async function ready() {
    const s = setup();
    await s.upload();
    const av = s.db.select().from(approvals).all().find((a) => a.kind === 'approve_video')!;
    return { ...s, av };
  }

  it('POST /approvals/:id/decide với make_video → 400, không đổi trạng thái', async () => {
    const s = setup();
    const r = await s.json('POST', '/approvals/MK1/decide', { status: 'approved' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Làm video được đóng khi video được duyệt');
    expect(s.db.select().from(approvals).where(eq(approvals.id, 'MK1')).get()!.status).toBe('pending');
  });

  it('Duyệt → phiên bản approved, make_video approved, bước video done, chiến dịch sang bước đăng', async () => {
    const s = await ready();
    expect((await s.json('POST', `/approvals/${s.av.id}/decide`, { status: 'approved' })).status).toBe(200);
    expect(s.versions()[0]!.status).toBe('approved');
    expect(s.db.select().from(approvals).where(eq(approvals.id, 'MK1')).get()!.status).toBe('approved');
    expect(s.db.select().from(campaigns).where(eq(campaigns.id, s.cid)).get()).toMatchObject({ status: 'active', currentStage: 'publishing' });
  });

  it('Từ chối → rejected, make_video mở, tệp cũ còn trong lịch sử, tải bản mới được (number 2)', async () => {
    const s = await ready();
    expect((await s.json('POST', `/approvals/${s.av.id}/decide`, { status: 'rejected' })).status).toBe(200);
    expect(s.versions()[0]).toMatchObject({ status: 'rejected', path: 'VV0.mp4' });
    expect(s.db.select().from(approvals).where(eq(approvals.id, 'MK1')).get()!.status).toBe('pending');
    expect((await s.upload()).body).toMatchObject({ number: 2, status: 'ready' });
    expect(s.versions().map((v) => v.status)).toEqual(['rejected', 'ready']);
    expect(s.files()).toHaveLength(2);
  });

  it('changes_requested với approve_video → 400', async () => {
    const s = await ready();
    expect((await s.json('POST', `/approvals/${s.av.id}/decide`, { status: 'changes_requested' })).status).toBe(400);
    expect(s.db.select().from(approvals).where(eq(approvals.id, s.av.id)).get()!.status).toBe('pending');
  });

  it('GET /approvals gắn latestVideo cho make_video và approve_video; videoAvailable cho choose_script', async () => {
    const s = setup();
    const before = (await s.json('GET', '/approvals?status=pending')).body.find((a: { id: string }) => a.id === 'MK1');
    expect(before.latestVideo).toMatchObject({ id: 'VV0', number: 1, status: 'awaiting_upload' });
    expect(before.latestVideo.path).toBeUndefined();
    await s.upload();
    const list = (await s.json('GET', '/approvals?status=pending')).body;
    expect(list.find((a: { kind: string }) => a.kind === 'approve_video').latestVideo).toMatchObject({ id: 'VV0', status: 'ready', mime: 'video/mp4' });

    s.db.insert(approvals).values({ id: 'CS', workspaceId: s.ids.workspace, campaignId: s.cid, kind: 'choose_script', subject: { kind: 'artifact', ids: [] }, status: 'pending', createdAt: T0, updatedAt: T0 }).run();
    const cs = () => s.json('GET', '/approvals?status=pending').then((r) => r.body.find((a: { id: string }) => a.id === 'CS'));
    expect((await cs()).videoAvailable).toBe(false); // bước video đang awaiting_approval
    s.db.update(campaignStages).set({ status: 'pending' }).where(eq(campaignStages.campaignId, s.cid)).run();
    expect((await cs()).videoAvailable).toBe(true);
    s.db.update(campaignStages).set({ status: 'skipped' }).where(eq(campaignStages.campaignId, s.cid)).run();
    expect((await cs()).videoAvailable).toBe(false);
  });
});

describe('GET /videos/:versionId/file', () => {
  const FULL = Buffer.from('0123456789abcdefghij');
  async function served() {
    const s = setup();
    await s.upload(FULL);
    return s;
  }
  it('200 đầy đủ với Content-Type, Accept-Ranges', async () => {
    const s = await served();
    const res = await s.app.request('/videos/VV0/file');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(FULL);
  });
  it('Range → 206 với Content-Range đúng (a-b, a-, -n); sai → 416', async () => {
    const s = await served();
    const get = (range: string) => s.app.request('/videos/VV0/file', { headers: { range } });
    const a = await get('bytes=2-5');
    expect(a.status).toBe(206);
    expect(a.headers.get('content-range')).toBe('bytes 2-5/20');
    expect(Buffer.from(await a.arrayBuffer()).toString()).toBe('2345');
    const b = await get('bytes=15-');
    expect(b.headers.get('content-range')).toBe('bytes 15-19/20');
    expect(Buffer.from(await b.arrayBuffer()).toString()).toBe('fghij');
    const c = await get('bytes=-4');
    expect(c.headers.get('content-range')).toBe('bytes 16-19/20');
    expect(Buffer.from(await c.arrayBuffer()).toString()).toBe('ghij');
    expect((await get('bytes=0-999')).headers.get('content-range')).toBe('bytes 0-19/20');
    expect((await get('bytes=50-60')).status).toBe(416);
    expect((await get('bytes=a-b')).status).toBe(416);
  });
  it('không có phiên bản hoặc phiên bản invalid (không tệp) → 404', async () => {
    const s = setup(async () => ({ ...GOOD, codec: 'vp9' }));
    expect((await s.app.request('/videos/khong-co/file')).status).toBe(404);
    await s.upload();
    expect((await s.app.request('/videos/VV0/file')).status).toBe(404);
  });
});

describe('xoá chiến dịch', () => {
  it('xoá phiên bản video và tệp trên đĩa (cả bản rejected cũ)', async () => {
    const s = setup();
    await s.upload();
    const av = s.db.select().from(approvals).all().find((a) => a.kind === 'approve_video')!;
    await s.json('POST', `/approvals/${av.id}/decide`, { status: 'rejected' });
    await s.upload();
    expect(s.files()).toHaveLength(2);
    expect(s.versions()).toHaveLength(2);
    const res = await s.app.request(`/campaigns/${s.cid}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(s.versions()).toHaveLength(0);
    expect(s.files()).toEqual([]);
  });
});
