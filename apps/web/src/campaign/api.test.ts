import { describe, expect, it } from 'vitest';
import { createApiClient, type FetchLike } from './api.ts';

function fake(status = 200, body: unknown = {}) {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
  return { calls, client: createApiClient({ baseUrl: '/api', fetch: f }) };
}

describe('createApiClient', () => {
  it('GET /campaigns và /campaigns/:id', async () => {
    const { calls, client } = fake(200, []);
    await client.listCampaigns();
    await client.getCampaign('c 1');
    expect(calls[0]).toEqual({ url: '/api/campaigns', init: { method: 'GET' } });
    expect(calls[1]!.url).toBe('/api/campaigns/c%201');
    expect(calls[1]!.init?.method).toBe('GET');
  });

  it('POST /campaigns gửi JSON { title }', async () => {
    const { calls, client } = fake(201, { id: 'x' });
    expect(await client.createCampaign('Hè')).toEqual({ id: 'x' });
    expect(calls[0]!.url).toBe('/api/campaigns');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ title: 'Hè' });
  });

  it('tin nhắn Director: GET và POST', async () => {
    const { calls, client } = fake(201, { id: 'm' });
    await client.listDirectorMessages('c 1');
    await client.sendDirectorMessage('chào', 'c1');
    expect(calls[0]!.url).toBe('/api/conversations/director/messages?limit=200&campaignId=c%201');
    expect(calls[0]!.init?.method).toBe('GET');
    expect(calls[1]!.init?.method).toBe('POST');
    expect(calls[1]!.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(calls[1]!.init!.body!)).toEqual({ content: 'chào', campaignId: 'c1' });
  });

  it('tải ảnh lên rồi gửi tin kèm ảnh', async () => {
    const { calls, client } = fake(201, { id: 'u1', name: 'a.png', mime: 'image/png' });
    const a = await client.uploadImage({ name: 'a.png', mime: 'image/png', data: 'QUJD' });
    await client.sendDirectorMessage('', 'c1', [a]);
    expect(calls[0]!.url).toBe('/api/uploads');
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ name: 'a.png', mime: 'image/png', data: 'QUJD' });
    expect(JSON.parse(calls[1]!.init!.body!)).toEqual({ content: '', campaignId: 'c1', attachments: [a] });
  });

  it('đăng bài: tài khoản, app Meta, token, bài đăng và hành động trên bài', async () => {
    const { calls, client } = fake(200, {});
    await client.getPublishAccounts();
    await client.saveFacebookApp('123456', 'sec');
    await client.connectFacebookToken('tok');
    await client.selectFacebookPage('s 1', 'p1');
    await client.disconnectAccount('a 1');
    await client.listPosts('c 1');
    await client.retryPost('p 1');
    await client.markPostPublished('p1', ' https://x.com/a ');
    await client.markPostPublished('p1');
    await client.cancelPost('p1');
    expect(calls.map((c) => `${c.init?.method} ${c.url}`)).toEqual([
      'GET /api/publish/accounts',
      'PUT /api/publish/facebook/app',
      'POST /api/publish/facebook/token',
      'POST /api/publish/facebook/pages/select',
      'DELETE /api/publish/accounts/a%201',
      'GET /api/campaigns/c%201/posts',
      'POST /api/posts/p%201/retry',
      'POST /api/posts/p1/mark-published',
      'POST /api/posts/p1/mark-published',
      'POST /api/posts/p1/cancel',
    ]);
    expect(JSON.parse(calls[1]!.init!.body!)).toEqual({ appId: '123456', appSecret: 'sec' });
    expect(JSON.parse(calls[3]!.init!.body!)).toEqual({ selectionId: 's 1', pageId: 'p1' });
    expect(JSON.parse(calls[7]!.init!.body!)).toEqual({ link: 'https://x.com/a' });
    expect(JSON.parse(calls[8]!.init!.body!)).toEqual({});
  });

  it('lỗi HTTP ném Error với thông điệp server', async () => {
    const { client } = fake(400, { error: 'Cần tiêu đề' });
    await expect(client.createCampaign('')).rejects.toThrow('Cần tiêu đề');
  });

  it('lỗi HTTP không có body JSON dùng mã trạng thái', async () => {
    const f: FetchLike = async () => ({ ok: false, status: 502, json: async () => { throw new Error('x'); } });
    await expect(createApiClient({ baseUrl: '/api', fetch: f }).listCampaigns()).rejects.toThrow('502');
  });
});
