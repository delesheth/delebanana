import { describe, expect, it } from 'vitest';
import { ApiError, createApi, type FetchLike } from './api.ts';

function fake(status = 200, body: unknown = []) {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
  return { calls, api: createApi({ baseUrl: '/api', fetch }) };
}

describe('api', () => {
  it('GET /approvals?status=pending', async () => {
    const f = fake(200, [{ id: 'A' }]);
    expect(await f.api.pendingApprovals()).toEqual([{ id: 'A' }]);
    expect(f.calls[0]).toEqual({ url: '/api/approvals?status=pending', init: { method: 'GET' } });
  });

  it('POST /approvals/:id/decide gửi status + decision dạng JSON', async () => {
    const f = fake(200, { ok: true });
    await f.api.decide('A1', 'approved', { chosen: ['S1'] });
    const c = f.calls[0]!;
    expect(c.url).toBe('/api/approvals/A1/decide');
    expect(c.init?.method).toBe('POST');
    expect(c.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(c.init!.body as string)).toEqual({ status: 'approved', decision: { chosen: ['S1'] } });
  });

  it('GET /providers', async () => {
    const f = fake(200, []);
    await f.api.providers();
    expect(f.calls[0]).toEqual({ url: '/api/providers', init: { method: 'GET' } });
  });

  it('POST /providers/:provider/unblock', async () => {
    const f = fake(200, { ok: true });
    await f.api.unblock('claude');
    const c = f.calls[0]!;
    expect(c.url).toBe('/api/providers/claude/unblock');
    expect(c.init?.method).toBe('POST');
    expect(c.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(c.init!.body as string)).toEqual({});
  });

  it('lỗi từ server ném ApiError mang thông điệp của server', async () => {
    const f = fake(409, { error: 'Yêu cầu này đã được quyết định' });
    await expect(f.api.decide('A1', 'rejected')).rejects.toMatchObject({ name: 'ApiError', status: 409, message: 'Yêu cầu này đã được quyết định' });
    await expect(f.api.decide('A1', 'rejected')).rejects.toBeInstanceOf(ApiError);
  });

  it('mất mạng ném ApiError, không nuốt im', async () => {
    const api = createApi({ baseUrl: '/api', fetch: async () => { throw new Error('x'); } });
    await expect(api.providers()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api.uploadVideo', () => {
  it('POST thân thô với Content-Type của tệp tới /videos/:id/upload', async () => {
    const f = fake(201, { versionId: 'V1', number: 1, status: 'ready', reasons: [] });
    const file = new File([new Uint8Array([1, 2, 3])], 'a.mp4', { type: 'video/mp4' });
    expect(await f.api.uploadVideo('MK 1', file)).toMatchObject({ status: 'ready' });
    const c = f.calls[0]!;
    expect(c.url).toBe('/api/videos/MK%201/upload');
    expect(c.init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'video/mp4' } });
    expect(c.init?.body).toBe(file);
  });

  it('lỗi server → ApiError kèm thông điệp và mã', async () => {
    const f = fake(503, { error: 'Chưa cài ffprobe. Cài bằng `brew install ffmpeg` rồi tải lại.' });
    await expect(f.api.uploadVideo('MK1', new File(['x'], 'a.mp4', { type: 'video/mp4' }))).rejects.toMatchObject({ status: 503, message: expect.stringContaining('brew install ffmpeg') });
  });
});
