// HTTP của bước đăng (phiếu D): cấu hình app Meta, kết nối Facebook (OAuth + dán token), bài đăng và hành động trên bài.
// Phản hồi không bao giờ chứa token, App Secret hay code OAuth.

import { asc, eq, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { ApprovalError } from '../campaign/shared.ts';
import { cancelPost, markPostPublished, retryPost } from '../campaign/publishing.ts';
import { runTx, type Deps } from '../core/unitOfWork.ts';
import { posts, workspaces } from '../db/schema.ts';
import type { Accounts } from '../publish/accounts.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (ok: boolean, message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Dele Banana — Kết nối Facebook</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${ok ? 'Xong' : 'Chưa kết nối được'}</h2><p>${esc(message)}</p><p>Bạn có thể đóng tab này.</p></body>`;

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    // rơi xuống lỗi dưới
  }
  throw new ApprovalError(400, 'Nội dung phải là JSON object');
}

export function mountPublish(app: Hono, deps: Deps, accounts: Accounts): void {
  const { db } = deps;
  const workspaceOf = (c: Context) => c.req.query('workspaceId') ?? db.select({ id: workspaces.id }).from(workspaces).where(isNull(workspaces.archivedAt)).get()?.id ?? '';

  app.get('/publish/facebook/app', (c) => c.json(accounts.appStatus()));
  app.put('/publish/facebook/app', async (c) => {
    const b = await body(c);
    accounts.setApp(String(b.appId ?? ''), String(b.appSecret ?? ''));
    return c.json(accounts.appStatus());
  });

  app.get('/oauth/facebook/start', (c) => c.redirect(accounts.startOAuth(workspaceOf(c))));
  app.get('/oauth/facebook/callback', async (c) => {
    const err = c.req.query('error');
    if (err) return c.html(page(false, 'Bạn đã từ chối hoặc Facebook báo lỗi khi đăng nhập.'), 400);
    const r = await accounts.handleCallback(c.req.query('code') ?? '', c.req.query('state') ?? '');
    return c.html(page(r.ok, r.message), r.ok ? 200 : 400);
  });

  app.get('/publish/accounts', (c) => {
    const ws = workspaceOf(c);
    return c.json({ accounts: accounts.listAccounts(ws), pending: accounts.pendingSelections(ws), app: accounts.appStatus() });
  });
  app.post('/publish/facebook/token', async (c) => {
    const b = await body(c);
    return c.json(await accounts.connectWithToken(workspaceOf(c), String(b.token ?? '')), 201);
  });
  app.post('/publish/facebook/pages/select', async (c) => {
    const b = await body(c);
    return c.json(await accounts.selectPage(String(b.selectionId ?? ''), String(b.pageId ?? '')), 201);
  });
  app.delete('/publish/accounts/:id', (c) => {
    accounts.disconnect(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/campaigns/:id/posts', (c) => c.json(db.select().from(posts).where(eq(posts.campaignId, c.req.param('id'))).orderBy(asc(posts.createdAt)).all()));
  app.post('/posts/:id/retry', async (c) => {
    // Body tuỳ chọn: không có (hoặc không phải JSON) thì thử lại như cũ.
    const b = await c.req.json().catch(() => null);
    const when = b && typeof b === 'object' ? (b as Record<string, unknown>).when : undefined;
    runTx(deps, (u) => retryPost(u, c.req.param('id'), when));
    return c.json({ ok: true });
  });
  app.post('/posts/:id/mark-published', async (c) => {
    const b = await body(c);
    const link = b.link === undefined || b.link === null ? undefined : String(b.link);
    runTx(deps, (u) => markPostPublished(u, c.req.param('id'), link));
    return c.json({ ok: true });
  });
  app.post('/posts/:id/cancel', (c) => {
    runTx(deps, (u) => cancelPost(u, c.req.param('id')));
    return c.json({ ok: true });
  });
}
