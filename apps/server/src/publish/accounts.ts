// Kết nối tài khoản xã hội (Facebook Page + tài khoản Instagram liên kết với Page): App ID/Secret cục bộ, OAuth (Facebook Login) có state, dán token tay làm dự phòng.
// Token và App Secret chỉ đọc ở file này và worker; mọi hàm trả ra ngoài không có chúng.

import type { MetaAppStatus, SocialAccountRow } from '@delebanana/domain';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { runTx, type Deps } from '../core/unitOfWork.ts';
import { platformApps, socialAccounts, socialCredentials } from '../db/schema.ts';
import { newId } from '../ids.ts';
import { ApprovalError } from '../campaign/shared.ts';
import { FB_SCOPES, MetaError, OAUTH_DIALOG_URL, type MetaApp, type MetaClient } from './meta.ts';

const STATE_TTL_MS = 10 * 60_000;
const SELECTION_TTL_MS = 10 * 60_000;
const NEED_TASK = 'CREATE_CONTENT';

export const callbackPath = '/oauth/facebook/callback';
export const redirectUriFor = (port: number) => `http://localhost:${port}${callbackPath}`;

/** Che token trong chuỗi bất kỳ (lỗi, log) trước khi lưu hay trả ra ngoài. */
export function scrub(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const sec of secrets) if (sec && sec.length >= 6) out = out.split(sec).join('[đã che]');
  return out.replace(/EAA[A-Za-z0-9]{10,}/g, '[đã che]');
}

interface PagePick {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}
type AccountMeta = { scopes: string[]; tokenExpiresAt: number | null; dataAccessExpiresAt: number | null };
interface Pending {
  workspaceId: string;
  pages: PagePick[];
  scopes: string[];
  tokenExpiresAt: number | null;
  dataAccessExpiresAt: number | null;
  expiresAt: number;
}

export class Accounts {
  private states = new Map<string, { workspaceId: string; expiresAt: number }>();
  private pending = new Map<string, Pending>();

  private deps: Deps;
  private client: MetaClient;
  private port: number;

  constructor(deps: Deps, client: MetaClient, port: number) {
    this.deps = deps;
    this.client = client;
    this.port = port;
  }

  private now() {
    return this.deps.clock?.() ?? Date.now();
  }

  appCredentials(): MetaApp | undefined {
    const r = this.deps.db.select().from(platformApps).where(eq(platformApps.platform, 'facebook')).get();
    return r ? { appId: r.appId, appSecret: r.appSecret } : undefined;
  }

  appStatus(): MetaAppStatus {
    const r = this.deps.db.select({ appId: platformApps.appId }).from(platformApps).where(eq(platformApps.platform, 'facebook')).get();
    return { configured: !!r, appId: r?.appId ?? null, hasSecret: !!r, redirectUri: redirectUriFor(this.port) };
  }

  /** Lưu App ID/Secret; Secret để trống = giữ Secret cũ. */
  setApp(appId: string, appSecret: string): void {
    const id = appId.trim();
    if (!/^\d{5,25}$/.test(id)) throw new ApprovalError(400, 'App ID là dãy số (lấy ở Meta for Developers → App settings → Basic)');
    const old = this.appCredentials();
    const secret = appSecret.trim() || old?.appSecret;
    if (!secret) throw new ApprovalError(400, 'Cần App Secret');
    const now = this.now();
    this.deps.db
      .insert(platformApps)
      .values({ platform: 'facebook', appId: id, appSecret: secret, updatedAt: now })
      .onConflictDoUpdate({ target: platformApps.platform, set: { appId: id, appSecret: secret, updatedAt: now } })
      .run();
  }

  listAccounts(workspaceId?: string): SocialAccountRow[] {
    const now = this.now();
    const q = this.deps.db.select().from(socialAccounts);
    const rows = (workspaceId ? q.where(and(eq(socialAccounts.workspaceId, workspaceId), isNull(socialAccounts.archivedAt))) : q.where(isNull(socialAccounts.archivedAt))).orderBy(desc(socialAccounts.updatedAt)).all();
    return rows.map(({ archivedAt: _a, ...r }) => ({
      ...r,
      platform: r.platform as SocialAccountRow['platform'],
      status: r.status === 'expired' || (r.tokenExpiresAt != null && r.tokenExpiresAt <= now) || (r.dataAccessExpiresAt != null && r.dataAccessExpiresAt <= now) ? 'expired' : 'connected',
    }));
  }

  /** Ngắt tài khoản; ngắt Page thì ngắt luôn tài khoản Instagram liên kết (dùng chung Page token). */
  disconnect(accountId: string): void {
    const now = this.now();
    this.deps.db.transaction((tx) => {
      const ids = [accountId, ...tx.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.parentAccountId, accountId)).all().map((r) => r.id)];
      tx.update(socialAccounts).set({ archivedAt: now, updatedAt: now }).where(inArray(socialAccounts.id, ids)).run();
      tx.delete(socialCredentials).where(inArray(socialCredentials.accountId, ids)).run();
    });
  }

  /** Chỉ worker gọi: token của tài khoản. */
  accessToken(accountId: string): string | undefined {
    return this.deps.db.select({ t: socialCredentials.accessToken }).from(socialCredentials).where(eq(socialCredentials.accountId, accountId)).get()?.t;
  }

  /** Token hết hạn: Page và tài khoản Instagram dùng chung token (cha/con) cùng hết hạn. */
  markExpired(accountId: string): void {
    const parent = this.deps.db.select({ p: socialAccounts.parentAccountId }).from(socialAccounts).where(eq(socialAccounts.id, accountId)).get()?.p;
    const root = parent ?? accountId;
    this.deps.db.update(socialAccounts).set({ status: 'expired', updatedAt: this.now() }).where(or(eq(socialAccounts.id, root), eq(socialAccounts.parentAccountId, root))).run();
  }

  /** URL Facebook Login để mở ở trình duyệt; state ngẫu nhiên dùng một lần, hết hạn sau 10 phút. */
  startOAuth(workspaceId: string): string {
    const app = this.appCredentials();
    if (!app) throw new ApprovalError(400, 'Chưa nhập App ID/App Secret của app Meta');
    const now = this.now();
    for (const [k, v] of this.states) if (v.expiresAt <= now) this.states.delete(k);
    const state = randomBytes(24).toString('hex');
    this.states.set(state, { workspaceId, expiresAt: now + STATE_TTL_MS });
    const q = new URLSearchParams({ client_id: app.appId, redirect_uri: redirectUriFor(this.port), state, scope: FB_SCOPES.join(','), response_type: 'code' });
    return `${OAUTH_DIALOG_URL}?${q}`;
  }

  /**
   * Callback OAuth: kiểm state, đổi code → user token → long-lived → Page token. Một Page có CREATE_CONTENT thì kết nối luôn;
   * nhiều Page thì chờ người dùng chọn (`pendingSelection`). Trả thông điệp ngắn cho trang HTML (không chứa code/token).
   */
  async handleCallback(code: string, state: string): Promise<{ ok: boolean; message: string }> {
    const now = this.now();
    const st = this.states.get(state);
    this.states.delete(state);
    if (!st || st.expiresAt <= now) return { ok: false, message: 'Phiên đăng nhập Facebook đã hết hạn hoặc không hợp lệ. Hãy bấm Kết nối Facebook lại.' };
    const app = this.appCredentials();
    if (!app) return { ok: false, message: 'Chưa nhập App ID/App Secret.' };
    try {
      const short = await this.client.exchangeCode(app, code, redirectUriFor(this.port));
      const long = await this.client.exchangeLongLived(app, short.accessToken);
      const pages = (await this.client.listPages(long.accessToken)).filter((p) => p.tasks.length === 0 || p.tasks.includes(NEED_TASK));
      if (pages.length === 0) return { ok: false, message: 'Không có Page nào bạn được quyền đăng bài (cần task CREATE_CONTENT). Kiểm tra quyền admin của Page.' };
      let dbg: Awaited<ReturnType<MetaClient['debugToken']>> | undefined;
      try {
        dbg = await this.client.debugToken(app, long.accessToken);
      } catch {
        // Không bắt buộc: thiếu thì không hiển thị hạn.
      }
      const meta = { scopes: dbg?.scopes ?? [], tokenExpiresAt: null, dataAccessExpiresAt: dbg?.dataAccessExpiresAt ?? null };
      if (pages.length === 1) {
        const acc = await this.saveAccount(st.workspaceId, pages[0]!, meta);
        const ig = this.listAccounts(st.workspaceId).find((a) => a.parentAccountId === acc.id);
        return { ok: true, message: `Đã kết nối Page "${pages[0]!.name}"${ig ? ` và Instagram ${ig.displayName}` : ''}. Quay lại Dele Banana.` };
      }
      const id = newId();
      this.pending.set(id, { workspaceId: st.workspaceId, pages, ...meta, expiresAt: now + SELECTION_TTL_MS });
      return { ok: true, message: 'Đăng nhập xong. Quay lại Dele Banana để chọn Page.' };
    } catch (e) {
      return { ok: false, message: scrub(e instanceof MetaError ? e.message : 'Không kết nối được Facebook.', [code, app.appSecret]) };
    }
  }

  /** Page đang chờ chọn sau OAuth (không có token). */
  pendingSelections(workspaceId: string): { selectionId: string; pages: { id: string; name: string }[] }[] {
    const now = this.now();
    for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k);
    return [...this.pending].filter(([, v]) => v.workspaceId === workspaceId).map(([selectionId, v]) => ({ selectionId, pages: v.pages.map((p) => ({ id: p.id, name: p.name })) }));
  }

  async selectPage(selectionId: string, pageId: string): Promise<SocialAccountRow> {
    const p = this.pending.get(selectionId);
    if (!p || p.expiresAt <= this.now()) throw new ApprovalError(404, 'Phiên chọn Page đã hết hạn — kết nối lại');
    const page = p.pages.find((x) => x.id === pageId);
    if (!page) throw new ApprovalError(400, 'Page không nằm trong danh sách');
    this.pending.delete(selectionId);
    return this.saveAccount(p.workspaceId, page, p);
  }

  /** Dự phòng: dán Page access token (Graph API Explorer). Kiểm bằng Graph API trước khi lưu. */
  async connectWithToken(workspaceId: string, token: string): Promise<SocialAccountRow> {
    const tok = token.trim();
    if (tok.length < 20) throw new ApprovalError(400, 'Token quá ngắn — dán Page access token đầy đủ');
    let page: Awaited<ReturnType<MetaClient['getPage']>>;
    try {
      page = await this.client.getPage(tok);
    } catch (e) {
      throw new ApprovalError(400, scrub(e instanceof MetaError ? `Token không dùng được: ${e.message}` : 'Không kiểm được token', [tok]));
    }
    if (page.tasks && !page.tasks.includes(NEED_TASK)) throw new ApprovalError(400, `Tài khoản của token không có quyền CREATE_CONTENT trên Page "${page.name}"`);
    let tokenExpiresAt: number | null = null;
    let dataAccessExpiresAt: number | null = null;
    let scopes: string[] = [];
    const app = this.appCredentials();
    if (app) {
      try {
        const d = await this.client.debugToken(app, tok);
        if (!d.isValid) throw new ApprovalError(400, 'Token không hợp lệ hoặc đã hết hạn');
        tokenExpiresAt = d.expiresAt;
        dataAccessExpiresAt = d.dataAccessExpiresAt;
        scopes = d.scopes;
      } catch (e) {
        if (e instanceof ApprovalError) throw e;
        // debug_token không bắt buộc (cần App Secret đúng app phát token): bỏ qua, không hiển thị hạn.
      }
    }
    return this.saveAccount(workspaceId, { id: page.id, name: page.name, accessToken: tok, tasks: page.tasks ?? [] }, { scopes, tokenExpiresAt, dataAccessExpiresAt });
  }

  /** Lưu Page rồi tìm tài khoản Instagram liên kết (gọi mạng ngoài giao dịch). Lỗi khi tìm IG không chặn việc lưu Page. */
  private async saveAccount(workspaceId: string, page: PagePick, m: AccountMeta): Promise<SocialAccountRow> {
    const id = this.upsert(workspaceId, 'facebook', { externalId: page.id, displayName: page.name, accessToken: page.accessToken, parentAccountId: null }, m);
    let ig: Awaited<ReturnType<MetaClient['getInstagramAccount']>> | undefined;
    try {
      ig = await this.client.getInstagramAccount(page.id, page.accessToken);
    } catch (e) {
      console.error('Không tìm được tài khoản Instagram của Page:', scrub(e instanceof Error ? e.message : String(e), [page.accessToken]));
    }
    if (ig) this.upsert(workspaceId, 'instagram', { externalId: ig.id, displayName: `@${ig.username}`, accessToken: page.accessToken, parentAccountId: id }, m);
    else if (ig === null) this.archiveChildren(id);
    return this.listAccounts(workspaceId).find((a) => a.id === id)!;
  }

  /** Page không còn liên kết Instagram: ngắt tài khoản IG con cũ. */
  private archiveChildren(parentId: string) {
    for (const c of this.deps.db.select({ id: socialAccounts.id }).from(socialAccounts).where(and(eq(socialAccounts.parentAccountId, parentId), isNull(socialAccounts.archivedAt))).all()) this.disconnect(c.id);
  }

  private upsert(workspaceId: string, platform: 'facebook' | 'instagram', a: { externalId: string; displayName: string; accessToken: string; parentAccountId: string | null }, m: AccountMeta): string {
    const now = this.now();
    return runTx(this.deps, (u) => {
      const existing = u.tx
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(and(eq(socialAccounts.workspaceId, workspaceId), eq(socialAccounts.platform, platform), eq(socialAccounts.externalId, a.externalId)))
        .get();
      const values = { displayName: a.displayName, status: 'connected', tokenExpiresAt: m.tokenExpiresAt, dataAccessExpiresAt: m.dataAccessExpiresAt, scopes: m.scopes, parentAccountId: a.parentAccountId, archivedAt: null, updatedAt: now };
      const accountId = existing?.id ?? newId();
      if (existing) u.tx.update(socialAccounts).set(values).where(eq(socialAccounts.id, accountId)).run();
      else u.tx.insert(socialAccounts).values({ id: accountId, workspaceId, platform, externalId: a.externalId, createdAt: now, ...values }).run();
      u.tx
        .insert(socialCredentials)
        .values({ accountId, accessToken: a.accessToken, updatedAt: now })
        .onConflictDoUpdate({ target: socialCredentials.accountId, set: { accessToken: a.accessToken, updatedAt: now } })
        .run();
      u.audit({ workspaceId, actor: 'user', action: 'user.social_account.connect', target: { kind: 'social_account', id: accountId }, result: 'allowed', details: { platform, ...(platform === 'facebook' ? { page: a.displayName } : { account: a.displayName }) } });
      return accountId;
    });
  }
}
