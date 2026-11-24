import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FB_SCOPES, GRAPH_URL, IG_RUPLOAD_URL, MetaError, RUPLOAD_URL, classifyGraphError, createMetaClient, parseIgStatus, parseReelStatus, type FetchLike } from './meta.ts';

interface Rec {
  url: string;
  init: RequestInit & { duplex?: string };
}
function fakeFetch(...responses: (object | Error | { status: number; body: unknown })[]) {
  const calls: Rec[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init: (init ?? {}) as Rec['init'] });
    const r = responses.shift() ?? {};
    if (r instanceof Error) throw r;
    const status = 'status' in r && typeof r.status === 'number' ? r.status : 200;
    const body = 'status' in r && 'body' in r ? r.body : r;
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, client: createMetaClient(fetchFn) };
}
const hdr = (r: Rec, k: string) => (r.init.headers as Record<string, string>)[k];

describe('đăng Reels qua client giả lập fetch', () => {
  it('start → POST /{page}/video_reels upload_phase=start, token trong header Authorization (không trong URL)', async () => {
    const f = fakeFetch({ video_id: 'V1', upload_url: 'https://rupload.facebook.com/video-upload/v23.0/V1' });
    const r = await f.client.startReel('PG1', 'TOKEN123456');
    expect(r).toEqual({ videoId: 'V1', uploadUrl: 'https://rupload.facebook.com/video-upload/v23.0/V1' });
    expect(f.calls[0]!.url).toBe(`${GRAPH_URL}/PG1/video_reels`);
    expect(f.calls[0]!.url).not.toContain('TOKEN');
    expect(f.calls[0]!.init.method).toBe('POST');
    expect(hdr(f.calls[0]!, 'Authorization')).toBe('OAuth TOKEN123456');
    expect(new URLSearchParams(String(f.calls[0]!.init.body)).get('upload_phase')).toBe('start');
  });

  it('upload tệp cục bộ lên rupload.facebook.com với offset và file_size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, 'x'.repeat(100));
    const f = fakeFetch({ success: true });
    await f.client.uploadReel('V1', 'TOK', { path: file, size: 100 });
    expect(f.calls[0]!.url).toBe(`${RUPLOAD_URL}/V1`);
    expect(hdr(f.calls[0]!, 'Authorization')).toBe('OAuth TOK');
    expect(hdr(f.calls[0]!, 'offset')).toBe('0');
    expect(hdr(f.calls[0]!, 'file_size')).toBe('100');
    // rupload từ chối Transfer-Encoding: chunked kèm file_size (HTTP 400 ParameterValidationError): phải có Content-Length.
    expect(hdr(f.calls[0]!, 'Content-Length')).toBe('100');
    expect(f.calls[0]!.init.duplex).toBe('half');
  });

  it('finish PUBLISHED: video_state, description = caption; SCHEDULED kèm scheduled_publish_time', async () => {
    const f = fakeFetch({ success: true }, { success: true });
    await f.client.finishReel('PG1', 'TOK', { videoId: 'V1', state: 'PUBLISHED', description: 'Caption #a', scheduledPublishTime: 123 });
    const p = new URLSearchParams(String(f.calls[0]!.init.body));
    expect(Object.fromEntries(p)).toEqual({ upload_phase: 'finish', video_id: 'V1', video_state: 'PUBLISHED', description: 'Caption #a' });
    await f.client.finishReel('PG1', 'TOK', { videoId: 'V1', state: 'SCHEDULED', description: 'C', scheduledPublishTime: 1_900_000_000 });
    expect(Object.fromEntries(new URLSearchParams(String(f.calls[1]!.init.body)))).toMatchObject({ video_state: 'SCHEDULED', scheduled_publish_time: '1900000000' });
  });

  it('finish gắn cờ is_ai_generated khi video do AI tạo', async () => {
    const f = fakeFetch({ success: true });
    await f.client.finishReel('PG1', 'TOK', { videoId: 'V1', state: 'PUBLISHED', description: 'C', aiGenerated: true });
    expect(new URLSearchParams(String(f.calls[0]!.init.body)).get('is_ai_generated')).toBe('true');
  });

  it('OAuth: đổi code và long-lived dùng client_secret trong query, không cần mạng thật', async () => {
    const f = fakeFetch({ access_token: 'U1', expires_in: 3600 }, { access_token: 'U2' });
    expect(await f.client.exchangeCode({ appId: '123456', appSecret: 'SEC' }, 'CODE', 'http://localhost:8787/oauth/facebook/callback')).toEqual({ accessToken: 'U1', expiresIn: 3600 });
    expect(await f.client.exchangeLongLived({ appId: '123456', appSecret: 'SEC' }, 'U1')).toEqual({ accessToken: 'U2' });
    const q = new URL(f.calls[0]!.url).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ client_id: '123456', client_secret: 'SEC', code: 'CODE', redirect_uri: 'http://localhost:8787/oauth/facebook/callback' });
    expect(new URL(f.calls[1]!.url).searchParams.get('grant_type')).toBe('fb_exchange_token');
  });

  it('listPages / getPage / debugToken', async () => {
    const f = fakeFetch(
      { data: [{ id: 'P1', name: 'Trang', access_token: 'PT', tasks: ['CREATE_CONTENT'] }, { id: 'P2' }] },
      { id: 'P1', name: 'Trang', tasks: ['CREATE_CONTENT'] },
      { data: { is_valid: true, expires_at: 0, data_access_expires_at: 1_900_000_000, scopes: ['pages_manage_posts'] } },
    );
    expect(await f.client.listPages('U')).toEqual([{ id: 'P1', name: 'Trang', accessToken: 'PT', tasks: ['CREATE_CONTENT'] }]);
    expect(await f.client.getPage('PT')).toEqual({ id: 'P1', name: 'Trang', tasks: ['CREATE_CONTENT'] });
    expect(await f.client.debugToken({ appId: '1', appSecret: 'S' }, 'PT')).toEqual({ isValid: true, expiresAt: null, dataAccessExpiresAt: 1_900_000_000_000, scopes: ['pages_manage_posts'] });
    expect(hdr(f.calls[2]!, 'Authorization')).toBe('OAuth 1|S');
  });
});

describe('phân loại lỗi', () => {
  const err = (status: number, code?: number) => classifyGraphError(status, { error: { message: 'x', ...(code === undefined ? {} : { code }) } });
  it('tạm thời: HTTP 5xx và mã giới hạn tốc độ', () => {
    for (const code of [1, 2, 4, 17, 32, 341, 368, 613]) expect(err(400, code).transient, `${code}`).toBe(true);
    expect(err(503).transient).toBe(true);
    expect(err(500, 100).transient).toBe(true);
  });
  it('không tạm thời: token hết hạn (190), thiếu quyền (200, 10), 4xx khác', () => {
    expect(err(401, 190)).toMatchObject({ transient: false, tokenExpired: true });
    expect(err(403, 200).transient).toBe(false);
    expect(err(403, 10).transient).toBe(false);
    expect(err(400, 100).transient).toBe(false);
    expect(err(404).transient).toBe(false);
  });
  it('lỗi mạng (fetch ném) → tạm thời, thông báo không lộ URL/token', async () => {
    const f = fakeFetch(new TypeError('fetch failed https://graph.facebook.com/?access_token=SECRETTOKEN'));
    const e = (await f.client.startReel('P', 'SECRETTOKEN').catch((x: unknown) => x)) as MetaError;
    expect(e).toBeInstanceOf(MetaError);
    expect(e.transient).toBe(true);
    expect(e.message).not.toContain('SECRETTOKEN');
  });
  it('lỗi rupload dạng debug_info: giữ thông báo của Meta, retriable → tạm thời', async () => {
    const msg = 'Invalid Header format: expected either both Content-Length and X-Entity-Length, or Transfer-Encoding alone';
    const f = fakeFetch(
      { status: 400, body: { debug_info: { retriable: false, type: 'ParameterValidationError', message: msg } } },
      { status: 206, body: { debug_info: { retriable: true, type: 'PartialRequestError', message: 'Partial request (did not match length of file)' } } },
    );
    const dir = mkdtempSync(join(tmpdir(), 'meta-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, 'x');
    const e1 = (await f.client.uploadReel('V1', 'T', { path: file, size: 1 }).catch((x: unknown) => x)) as MetaError;
    expect(e1).toMatchObject({ transient: false, message: `Meta báo lỗi: ParameterValidationError: ${msg}` });
    // 206 là res.ok nhưng upload chưa đủ: vẫn là lỗi.
    await expect(f.client.uploadReel('V1', 'T', { path: file, size: 1 })).rejects.toMatchObject({ transient: true });
  });
  it('HTTP 200 mang thân error vẫn là lỗi', async () => {
    const f = fakeFetch({ error: { message: 'Rate', code: 4 } });
    await expect(f.client.startReel('P', 'T')).rejects.toMatchObject({ transient: true, code: 4 });
  });
});

describe('parseReelStatus', () => {
  it('chuẩn hoá các pha', () => {
    expect(parseReelStatus({ status: { video_status: 'error', processing_phase: { status: 'error', errors: [{ message: 'bad' }] } } })).toEqual({ phase: 'error', error: 'bad' });
    expect(parseReelStatus({ status: { publishing_phase: { status: 'complete', publish_status: 'published' } }, permalink_url: '/reel/1' })).toEqual({ phase: 'published', permalink: 'https://www.facebook.com/reel/1' });
    expect(parseReelStatus({ status: { publishing_phase: { publish_status: 'scheduled' } } }).phase).toBe('scheduled');
    expect(parseReelStatus({ status: { uploading_phase: { status: 'complete' }, video_status: 'processing' } }).phase).toBe('processing');
    expect(parseReelStatus({ status: { uploading_phase: { status: 'in_progress' } } }).phase).toBe('uploading');
  });
});

describe('Instagram Reels qua client giả lập fetch', () => {
  it('xin thêm quyền Instagram trong Facebook Login', () => {
    expect(FB_SCOPES).toEqual(expect.arrayContaining(['instagram_basic', 'instagram_content_publish']));
  });

  it('tìm tài khoản IG liên kết Page; Page không có IG → null', async () => {
    const f = fakeFetch({ id: 'PG1', instagram_business_account: { id: 'IG1', username: 'bongbong' } }, { id: 'PG1' });
    expect(await f.client.getInstagramAccount('PG1', 'TOK')).toEqual({ id: 'IG1', username: 'bongbong' });
    expect(f.calls[0]!.url).toContain(`${GRAPH_URL}/PG1?`);
    expect(decodeURIComponent(f.calls[0]!.url)).toContain('instagram_business_account{id,username}');
    expect(f.calls[0]!.url).not.toContain('TOK');
    expect(await f.client.getInstagramAccount('PG1', 'TOK')).toBeNull();
  });

  it('tạo container REELS resumable kèm caption → upload vào uri → publish creation_id → permalink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meta-ig-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, 'x'.repeat(10));
    const f = fakeFetch({ id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v23.0/C1' }, { success: true }, { id: 'M1' }, { permalink: 'https://www.instagram.com/reel/abc/' });
    const c = await f.client.createIgReel('IG1', 'TOK', 'Caption #a');
    expect(c).toEqual({ containerId: 'C1', uploadUrl: 'https://rupload.facebook.com/ig-api-upload/v23.0/C1' });
    expect(f.calls[0]!.url).toBe(`${GRAPH_URL}/IG1/media`);
    expect(Object.fromEntries(new URLSearchParams(String(f.calls[0]!.init.body)))).toEqual({ media_type: 'REELS', upload_type: 'resumable', caption: 'Caption #a', share_to_feed: 'true' });
    await f.client.uploadIgReel('C1', 'TOK', { path: file, size: 10 });
    expect(f.calls[1]!.url).toBe(`${IG_RUPLOAD_URL}/C1`);
    expect(hdr(f.calls[1]!, 'Authorization')).toBe('OAuth TOK');
    expect(hdr(f.calls[1]!, 'file_size')).toBe('10');
    expect(hdr(f.calls[1]!, 'Content-Length')).toBe('10');
    expect(await f.client.publishIgReel('IG1', 'TOK', 'C1')).toBe('M1');
    expect(f.calls[2]!.url).toBe(`${GRAPH_URL}/IG1/media_publish`);
    expect(new URLSearchParams(String(f.calls[2]!.init.body)).get('creation_id')).toBe('C1');
    expect(await f.client.igPermalink('M1', 'TOK')).toBe('https://www.instagram.com/reel/abc/');
  });

  it('trạng thái container: mã chuẩn, lỗi kèm mô tả, mã lạ coi như đang xử lý', () => {
    expect(parseIgStatus({ status_code: 'FINISHED' })).toEqual({ status: 'FINISHED' });
    expect(parseIgStatus({ status_code: 'ERROR', status: 'Error: video too long' })).toEqual({ status: 'ERROR', error: 'Error: video too long' });
    expect(parseIgStatus({ status_code: 'EXPIRED' })).toEqual({ status: 'EXPIRED' });
    expect(parseIgStatus({})).toEqual({ status: 'IN_PROGRESS' });
  });
});
