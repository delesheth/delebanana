import { eq } from 'drizzle-orm';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideApprovePublish } from '../campaign/publishing.ts';
import { audit, events, messages, platformApps, posts, socialAccounts, socialCredentials, tasks } from '../db/schema.ts';
import { Accounts } from '../publish/accounts.ts';
import { MetaError } from '../publish/meta.ts';
import { FakeMeta, SECRET_APP, SECRET_TOKEN, publishingSetup } from '../test/publishing.ts';
import { createApp } from './app.ts';

const CODE = 'CODE-FAKE-1234567890';

function setup(o: Parameters<typeof publishingSetup>[0] = {}) {
  const s = publishingSetup({ noAccount: true, platforms: ['facebook', 'instagram'], ...o });
  const meta = new FakeMeta();
  const accounts = new Accounts(s.deps, meta, 8787);
  const videoDir = mkdtempSync(join(tmpdir(), 'http-pub-'));
  writeFileSync(join(videoDir, 'VV-OK.mp4'), '0123456789');
  const app = createApp(s.deps, { accounts, port: 8787, videoDir });
  const seen: string[] = [];
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`http://localhost:8787${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers }, redirect: 'manual' });
    const text = await res.text();
    seen.push(text, JSON.stringify([...res.headers]));
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  const everything = () => JSON.stringify([s.db.select().from(events).all(), s.db.select().from(audit).all(), s.db.select().from(messages).all(), s.db.select().from(tasks).all(), seen]);
  return { ...s, meta, accounts, app, req, everything, videoDir };
}

describe('cấu hình app Meta', () => {
  it('lưu App ID/Secret ở SQLite; phản hồi chỉ có hasSecret, không có Secret', async () => {
    const s = setup();
    expect((await s.req('GET', '/publish/facebook/app')).json).toMatchObject({ configured: false, hasSecret: false, redirectUri: 'http://localhost:8787/oauth/facebook/callback' });
    const r = await s.req('PUT', '/publish/facebook/app', { appId: '1234567890', appSecret: SECRET_APP });
    expect(r.json).toMatchObject({ configured: true, appId: '1234567890', hasSecret: true });
    expect(r.text).not.toContain(SECRET_APP);
    expect(s.db.select().from(platformApps).get()!.appSecret).toBe(SECRET_APP);
    // Secret trống = giữ cũ
    await s.req('PUT', '/publish/facebook/app', { appId: '1234567891', appSecret: '' });
    expect(s.db.select().from(platformApps).get()).toMatchObject({ appId: '1234567891', appSecret: SECRET_APP });
    expect((await s.req('PUT', '/publish/facebook/app', { appId: 'abc', appSecret: 'x' })).status).toBe(400);
  });
});

describe('OAuth Facebook', () => {
  async function start(s: ReturnType<typeof setup>) {
    await s.req('PUT', '/publish/facebook/app', { appId: '1234567890', appSecret: SECRET_APP });
    const r = await s.req('GET', '/oauth/facebook/start');
    const url = new URL(r.headers.get('location')!);
    return { r, url, state: url.searchParams.get('state')! };
  }

  it('start chuyển sang Facebook Login với redirect localhost, scope đúng, state ngẫu nhiên; không lộ App Secret', async () => {
    const s = setup();
    expect((await s.req('GET', '/oauth/facebook/start')).status).toBe(400); // chưa nhập app
    const { r, url, state } = await start(s);
    expect(r.status).toBe(302);
    expect(url.origin + url.pathname).toMatch(/^https:\/\/www\.facebook\.com\/v[\d.]+\/dialog\/oauth$/);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/oauth/facebook/callback');
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(state).toHaveLength(48);
    expect(r.headers.get('location')).not.toContain(SECRET_APP);
  });

  it('callback: kiểm state, đổi code → long-lived → Page có CREATE_CONTENT; state dùng một lần; trang HTML không có bí mật', async () => {
    const s = setup();
    const { state } = await start(s);
    const bad = await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=sai`);
    expect(bad.status).toBe(400);
    expect(s.meta.calls).toEqual([]);
    const ok = await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=${state}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/html');
    expect(s.meta.names()).toEqual(['exchangeCode', 'exchangeLongLived', 'listPages', 'debugToken', 'getInstagramAccount']);
    expect(s.meta.calls[0]!.args).toEqual([CODE, 'http://localhost:8787/oauth/facebook/callback']);
    expect(s.meta.calls[1]!.args[0]).toBe('short-user-token-xxxxxxxx');
    expect(s.meta.calls[2]!.args[0]).toBe('long-user-token-xxxxxxxxx');
    expect(s.db.select().from(socialCredentials).get()!.accessToken).toBe(SECRET_TOKEN);
    const list = (await s.req('GET', '/publish/accounts')).json;
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0]).toMatchObject({ platform: 'facebook', externalId: 'PG1', displayName: 'Trang Bông', status: 'connected' });
    expect(list.accounts[0].accessToken).toBeUndefined();
    const again = await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=${state}`);
    expect(again.status).toBe(400);
  });

  it('state hết hạn sau 10 phút → từ chối', async () => {
    const s = setup();
    const { state } = await start(s);
    s.advance(11 * 60_000);
    expect((await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=${state}`)).status).toBe(400);
    expect(s.meta.calls).toEqual([]);
  });

  it('nhiều Page → chờ chọn; chọn xong mới lưu; Page không có CREATE_CONTENT bị loại', async () => {
    const s = setup();
    s.meta.pages = [
      { id: 'PG1', name: 'Trang A', accessToken: SECRET_TOKEN, tasks: ['CREATE_CONTENT'] },
      { id: 'PG2', name: 'Trang B', accessToken: 'EAAOTHERTOKEN-1234567890', tasks: ['MANAGE'] },
      { id: 'PG3', name: 'Trang C', accessToken: 'EAATHIRDTOKEN-1234567890', tasks: ['CREATE_CONTENT'] },
    ];
    const { state } = await start(s);
    expect((await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=${state}`)).status).toBe(200);
    expect(s.db.select().from(socialAccounts).all()).toHaveLength(0);
    const pending = (await s.req('GET', '/publish/accounts')).json.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0].pages).toEqual([{ id: 'PG1', name: 'Trang A' }, { id: 'PG3', name: 'Trang C' }]);
    expect(JSON.stringify(pending)).not.toContain('EAA');
    expect((await s.req('POST', '/publish/facebook/pages/select', { selectionId: pending[0].selectionId, pageId: 'PG2' })).status).toBe(400);
    const sel = await s.req('POST', '/publish/facebook/pages/select', { selectionId: pending[0].selectionId, pageId: 'PG3' });
    expect(sel.status).toBe(201);
    expect(sel.json.externalId).toBe('PG3');
    expect(s.db.select().from(socialCredentials).get()!.accessToken).toBe('EAATHIRDTOKEN-1234567890');
  });

  it('Meta báo lỗi khi đổi code → trang báo lỗi, không lưu gì, không lộ code', async () => {
    const s = setup();
    const { state } = await start(s);
    s.meta.fail.exchangeCode = [new MetaError(`Meta báo lỗi 100: code ${CODE} invalid`, { transient: false, code: 100 })];
    const r = await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=${state}`);
    expect(r.status).toBe(400);
    expect(r.text).not.toContain(CODE);
    expect(s.db.select().from(socialAccounts).all()).toHaveLength(0);
  });
});

describe('dán Page token (dự phòng)', () => {
  it('kiểm bằng Graph API trước khi lưu; đúng thì lưu, trạng thái connected, không trả token', async () => {
    const s = setup();
    const r = await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ externalId: 'PG1', displayName: 'Trang Bông', status: 'connected' });
    expect(r.text).not.toContain(SECRET_TOKEN);
    expect(s.meta.names()[0]).toBe('getPage');
    expect(s.db.select().from(socialCredentials).get()!.accessToken).toBe(SECRET_TOKEN);
    // dán lại cùng Page: cập nhật, không tạo bản trùng
    await s.req('POST', '/publish/facebook/token', { token: `${SECRET_TOKEN}-moi` });
    expect(s.db.select().from(socialAccounts).all()).toHaveLength(1);
  });

  it('token sai/thiếu quyền CREATE_CONTENT/quá ngắn → 400, không lưu, lỗi không chứa token', async () => {
    const s = setup();
    s.meta.fail.getPage = [new MetaError(`Meta báo lỗi 190: ${SECRET_TOKEN} expired`, { transient: false, code: 190, tokenExpired: true })];
    const r1 = await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    expect(r1.status).toBe(400);
    expect(r1.text).not.toContain(SECRET_TOKEN);
    s.meta.pageTasks = ['ANALYZE'];
    expect((await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN })).status).toBe(400);
    expect((await s.req('POST', '/publish/facebook/token', { token: 'ngan' })).status).toBe(400);
    expect(s.db.select().from(socialAccounts).all()).toHaveLength(0);
  });

  it('hạn token hiển thị: tokenExpiresAt đã qua → expired; ngắt kết nối xoá token', async () => {
    const s = setup();
    await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    s.db.update(socialAccounts).set({ tokenExpiresAt: 1 }).run();
    const list = (await s.req('GET', '/publish/accounts')).json.accounts;
    expect(list[0].status).toBe('expired');
    expect((await s.req('DELETE', `/publish/accounts/${list[0].id}`)).status).toBe(200);
    expect(s.db.select().from(socialCredentials).all()).toHaveLength(0);
    expect((await s.req('GET', '/publish/accounts')).json.accounts).toEqual([]);
  });
});

describe('Instagram liên kết với Page', () => {
  it('lưu Page có IG Business → thêm tài khoản instagram con dùng chung token; không trả token', async () => {
    const s = setup();
    s.meta.ig = { id: 'IG1', username: 'bongbong' };
    const r = await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    expect(r.status).toBe(201);
    expect(s.meta.calls.find((c) => c.fn === 'getInstagramAccount')!.args[0]).toBe('PG1');
    const list = (await s.req('GET', '/publish/accounts')).json.accounts as { id: string; platform: string; displayName: string; parentAccountId: string | null }[];
    const fb = list.find((a) => a.platform === 'facebook')!;
    expect(list.find((a) => a.platform === 'instagram')).toMatchObject({ externalId: 'IG1', displayName: '@bongbong', status: 'connected', parentAccountId: fb.id });
    expect(JSON.stringify(list)).not.toContain(SECRET_TOKEN);
    expect(s.db.select().from(socialCredentials).all().map((c) => c.accessToken)).toEqual([SECRET_TOKEN, SECRET_TOKEN]);
    // dán lại: không tạo bản trùng
    await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    expect(s.db.select().from(socialAccounts).all()).toHaveLength(2);
  });

  it('ngắt Page → ngắt luôn IG; Page bỏ liên kết IG → IG cũ bị ngắt; lỗi khi tìm IG không chặn lưu Page', async () => {
    const s = setup();
    s.meta.ig = { id: 'IG1', username: 'bongbong' };
    const fb = (await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN })).json;
    await s.req('DELETE', `/publish/accounts/${fb.id}`);
    expect((await s.req('GET', '/publish/accounts')).json.accounts).toEqual([]);
    expect(s.db.select().from(socialCredentials).all()).toHaveLength(0);

    await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    s.meta.ig = null;
    await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    expect((await s.req('GET', '/publish/accounts')).json.accounts.map((a: { platform: string }) => a.platform)).toEqual(['facebook']);

    s.meta.fail.getInstagramAccount = [new MetaError(`Meta báo lỗi 2: ${SECRET_TOKEN}`, { transient: true, code: 2 })];
    expect((await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN })).status).toBe(201);
  });

  it('token hết hạn ở Page → IG con cũng hết hạn', async () => {
    const s = setup();
    s.meta.ig = { id: 'IG1', username: 'bongbong' };
    const fb = (await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN })).json;
    s.accounts.markExpired(fb.id);
    expect((await s.req('GET', '/publish/accounts')).json.accounts.map((a: { status: string }) => a.status)).toEqual(['expired', 'expired']);
  });
});

describe('không rò bí mật', () => {
  it('sau kết nối, duyệt, đăng và lỗi: token/secret/code không có trong phản hồi, events, audit, tin nhắn, task', async () => {
    const s = setup();
    await s.req('PUT', '/publish/facebook/app', { appId: '1234567890', appSecret: SECRET_APP });
    const st = new URL((await s.req('GET', '/oauth/facebook/start')).headers.get('location')!).searchParams.get('state');
    await s.req('GET', `/oauth/facebook/callback?code=${CODE}&state=${st}`);
    await s.req('POST', '/publish/facebook/token', { token: `${SECRET_TOKEN}` });
    const approval = s.finishCaption();
    const view = (await s.req('GET', '/approvals?status=pending')).json.find((a: any) => a.id === approval.id);
    expect(view.facebookReady).toBe(true);
    expect(view.posts).toHaveLength(2);
    await s.req('POST', `/approvals/${approval.id}/decide`, { status: 'approved', decision: { posts: [{ platform: 'facebook', enabled: true, caption: 'Cap' }, { platform: 'instagram', enabled: true }], when: { mode: 'now' } } });
    // lỗi worker chứa token trong thông báo Meta
    const { PublishWorker } = await import('../publish/worker.ts');
    s.meta.fail.startReel = [new MetaError(`lỗi ${SECRET_TOKEN} ${SECRET_APP}`, { transient: false, code: 100 })];
    await new PublishWorker(s.deps, s.meta, s.accounts, { videoDir: s.videoDir }).tick();
    expect(s.db.select().from(posts).all().find((p) => p.platform === 'facebook')!.status).toBe('failed');
    await s.req('GET', `/campaigns/${s.id}/posts`);
    await s.req('GET', `/campaigns/${s.id}`);
    await s.req('GET', '/snapshot');
    const all = s.everything();
    for (const secret of [SECRET_TOKEN, SECRET_APP, CODE, 'long-user-token-xxxxxxxxx', 'short-user-token-xxxxxxxx']) expect(all, secret).not.toContain(secret);
  });
});

describe('bài đăng của chiến dịch', () => {
  it('GET /campaigns/:id/posts; Đã đăng (link) / Bỏ / Thử lại qua HTTP; sai → 400/409', async () => {
    const s = setup();
    await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    const a = s.finishCaption();
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', { posts: [{ platform: 'facebook', enabled: true }, { platform: 'instagram', enabled: true }], when: { mode: 'now' } }));
    const list = (await s.req('GET', `/campaigns/${s.id}/posts`)).json;
    expect(list.map((p: any) => [p.platform, p.status])).toEqual([['facebook', 'publishing'], ['instagram', 'scheduled']]);
    const ig = list[1].id;
    expect((await s.req('POST', `/posts/${ig}/mark-published`, { link: 'not a url' })).status).toBe(400);
    expect((await s.req('POST', `/posts/${list[0].id}/retry`)).status).toBe(409);
    expect((await s.req('POST', `/posts/${ig}/mark-published`, { link: 'https://instagram.com/reel/x' })).status).toBe(200);
    expect(s.db.select().from(posts).all().find((p) => p.id === ig)).toMatchObject({ status: 'published', permalink: 'https://instagram.com/reel/x' });
    expect((await s.req('POST', `/posts/${list[0].id}/cancel`)).status).toBe(409);
    expect((await s.req('POST', '/posts/khong-co/cancel')).status).toBe(404);
  });

  it('GET /videos/:id/file?download=1 có Content-Disposition attachment', async () => {
    const s = setup();
    const r = await s.req('GET', '/videos/VV-OK/file?download=1');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="video-1\.mp4"$/);
    expect((await s.req('GET', '/videos/VV-OK/file')).headers.get('content-disposition')).toBeNull();
  });
});

describe('POST /posts/:id/retry nhận when', () => {
  it('when hợp lệ đổi giờ hẹn và sang publishing; when sai → 400; không body giữ hành vi cũ', async () => {
    const s = setup();
    await s.req('POST', '/publish/facebook/token', { token: SECRET_TOKEN });
    const a = s.finishCaption();
    const at = s.deps.clock!() + 60 * 60_000;
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', { posts: [{ platform: 'facebook', enabled: true }, { platform: 'instagram', enabled: false }], when: { mode: 'schedule', at } }));
    const fb = s.db.select().from(posts).all().find((p) => p.platform === 'facebook')!;
    // Giả lập worker đã lỗi vì giờ hẹn hết hiệu lực.
    s.db.update(posts).set({ status: 'failed', error: 'x', scheduledAt: s.deps.clock!() - 1000 }).where(eq(posts.id, fb.id)).run();
    const get = () => s.db.select().from(posts).where(eq(posts.id, fb.id)).get()!;
    expect((await s.req('POST', `/posts/${fb.id}/retry`)).status).toBe(400);
    expect((await s.req('POST', `/posts/${fb.id}/retry`, { when: { mode: 'schedule', at: s.deps.clock!() + 60_000 } })).status).toBe(400);
    expect(get().status).toBe('failed');
    const newAt = s.deps.clock!() + 3 * 60 * 60_000;
    expect((await s.req('POST', `/posts/${fb.id}/retry`, { when: { mode: 'schedule', at: newAt } })).status).toBe(200);
    expect(get()).toMatchObject({ status: 'publishing', scheduledAt: newAt });
  });
});
