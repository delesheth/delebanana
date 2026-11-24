// Dữ liệu và client Meta giả cho kiểm thử bước đăng (phiếu D). Không gọi mạng thật.

import { and, eq } from 'drizzle-orm';
import type { Platform } from '@delebanana/domain';
import { decideApproveVideo, createCampaign, activateCampaign, progressCampaign } from '../campaign/engine.ts';
import { EventBus } from '../core/bus.ts';
import { runTx } from '../core/unitOfWork.ts';
import { agents, approvals, artifacts, campaignStages, campaigns, posts, socialAccounts, socialCredentials, tasks, videoVersions } from '../db/schema.ts';
import type { DebugInfo, FinishInput, IgContainerStatus, MetaApp, MetaClient, PageInfo, ReelStatus, TokenInfo } from '../publish/meta.ts';
import { MetaError } from '../publish/meta.ts';
import { T0, minimal } from './fixtures.ts';

export const GOOD_PROBE = { formatName: 'mov,mp4', durationSeconds: 20, width: 1080, height: 1920, codec: 'h264' };
export const SECRET_TOKEN = 'EAAFAKEPAGETOKEN1234567890secret';
export const SECRET_APP = 'fake-app-secret-abcdef123456';

export interface Call {
  fn: string;
  args: unknown[];
}

/** Client Meta giả: ghi lại mọi lời gọi; `fail[fn]` là hàng đợi lỗi đưa ra lần lượt trước khi thành công. */
export class FakeMeta implements MetaClient {
  calls: Call[] = [];
  fail: Record<string, MetaError[]> = {};
  status: ReelStatus = { phase: 'processing' };
  pages: PageInfo[] = [{ id: 'PG1', name: 'Trang Bông', accessToken: SECRET_TOKEN, tasks: ['CREATE_CONTENT'] }];
  pageTasks: string[] | undefined = ['CREATE_CONTENT'];
  /** Tài khoản IG liên kết Page; null = Page chưa liên kết (mặc định). */
  ig: { id: string; username: string } | null = null;
  igStatus: IgContainerStatus = { status: 'IN_PROGRESS' };
  private n = 0;
  private c = 0;

  private rec(fn: string, ...args: unknown[]) {
    this.calls.push({ fn, args });
    const f = this.fail[fn]?.shift();
    if (f) throw f;
  }
  names = () => this.calls.map((c) => c.fn);
  async exchangeCode(_a: MetaApp, code: string, redirectUri: string): Promise<TokenInfo> {
    this.rec('exchangeCode', code, redirectUri);
    return { accessToken: 'short-user-token-xxxxxxxx' };
  }
  async exchangeLongLived(_a: MetaApp, t: string): Promise<TokenInfo> {
    this.rec('exchangeLongLived', t);
    return { accessToken: 'long-user-token-xxxxxxxxx', expiresIn: 5_000_000 };
  }
  async listPages(t: string) {
    this.rec('listPages', t);
    return this.pages;
  }
  async getPage(t: string) {
    this.rec('getPage', t);
    return { id: 'PG1', name: 'Trang Bông', ...(this.pageTasks ? { tasks: this.pageTasks } : {}) };
  }
  async debugToken(_a: MetaApp, t: string): Promise<DebugInfo> {
    this.rec('debugToken', t);
    return { isValid: true, expiresAt: null, dataAccessExpiresAt: T0 + 80 * 86_400_000, scopes: ['pages_manage_posts'] };
  }
  async startReel(pageId: string, t: string) {
    this.rec('startReel', pageId, t);
    return { videoId: `VID${++this.n}` };
  }
  async uploadReel(videoId: string, t: string, file: { path: string; size: number }) {
    this.rec('uploadReel', videoId, t, file);
  }
  async finishReel(pageId: string, t: string, i: FinishInput) {
    this.rec('finishReel', pageId, t, i);
  }
  async reelStatus(videoId: string, t: string) {
    this.rec('reelStatus', videoId, t);
    return this.status;
  }
  async getInstagramAccount(pageId: string, t: string) {
    this.rec('getInstagramAccount', pageId, t);
    return this.ig;
  }
  async createIgReel(igId: string, t: string, caption: string) {
    this.rec('createIgReel', igId, t, caption);
    return { containerId: `CT${++this.c}` };
  }
  async uploadIgReel(containerId: string, t: string, file: { path: string; size: number }) {
    this.rec('uploadIgReel', containerId, t, file);
  }
  async igContainerStatus(containerId: string, t: string) {
    this.rec('igContainerStatus', containerId, t);
    return this.igStatus;
  }
  async publishIgReel(igId: string, t: string, containerId: string) {
    this.rec('publishIgReel', igId, t, containerId);
    return `MED-${containerId}`;
  }
  async igPermalink(mediaId: string, t: string) {
    this.rec('igPermalink', mediaId, t);
    return `https://www.instagram.com/reel/${mediaId}/`;
  }
}

export interface SetupOpts {
  platforms?: Platform[];
  probe?: Record<string, unknown>;
  mime?: string;
  /** Không kết nối Facebook. */
  noAccount?: boolean;
  /** Có tài khoản Instagram (IGACC1, @bongbong) liên kết Page ACC1. */
  instagram?: boolean;
}

/** Chiến dịch mới đã tới bước đăng: video đã duyệt (kèm phiên bản ready/awaiting_upload sót), task caption đã tạo. */
export function publishingSetup(o: SetupOpts = {}) {
  const { db, ids } = minimal();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => ++now };
  const tx = <T>(fn: Parameters<typeof runTx<T>>[1]) => runTx(deps, fn);
  const platforms = o.platforms ?? ['facebook', 'instagram', 'tiktok'];
  const id = tx((u) => createCampaign(u, ids.workspace, 'Bông Bông'));
  db.update(campaigns).set({ brief: { goal: 'g', audience: 'a', product: 'p', platforms } }).where(eq(campaigns.id, id)).run();
  tx((u) => activateCampaign(u, id, `agent:${ids.director}`));
  db.insert(agents).values({ id: 'A-P', workspaceId: ids.workspace, roleTemplate: 'publisher', title: 'Publisher', name: 'Giang', provider: 'claude', model: 'sonnet', createdAt: T0, updatedAt: T0 }).run();
  const setStage = (stage: string, status: string) => db.update(campaignStages).set({ status }).where(and(eq(campaignStages.campaignId, id), eq(campaignStages.stage, stage))).run();
  setStage('research', 'done');
  setStage('scripting', 'done');
  setStage('video', 'awaiting_approval');
  db.update(campaigns).set({ currentStage: 'video' }).where(eq(campaigns.id, id)).run();
  db.insert(artifacts).values({ id: 'SCR1', campaignId: id, kind: 'script', content: { text: 'Kịch bản chọn' }, createdAt: T0 }).run();
  db.insert(artifacts).values({ id: 'VP1', campaignId: id, kind: 'video_prompt', content: { text: 'prompt', scriptArtifactId: 'SCR1' }, createdAt: T0 }).run();
  const mk = (aid: string, status: string) => db.insert(approvals).values({ id: aid, workspaceId: ids.workspace, campaignId: id, kind: 'make_video', subject: { kind: 'artifact', ids: ['VP1'], toolId: 'gemini' }, status, createdAt: T0, updatedAt: T0 }).run();
  mk('MK1', 'pending');
  mk('MK2', 'pending');
  const ver = (vid: string, make: string, status: string, updatedAt: number, path: string | null = `${vid}.mp4`) =>
    db.insert(videoVersions).values({ id: vid, campaignId: id, videoId: 'VP1', makeVideoApprovalId: make, number: 1, provider: 'manual', toolId: 'gemini', status, path, mime: o.mime ?? 'video/mp4', sizeBytes: 1234, metadata: o.probe ?? GOOD_PROBE, createdAt: T0, updatedAt }).run();
  ver('VV-OK', 'MK1', 'ready', T0);
  // Bản sót: cập nhật SAU bản được duyệt, để chắc chắn việc chọn không dựa vào độ mới hay status ready.
  ver('VV-LEFT-READY', 'MK2', 'ready', T0 + 10_000_000);
  ver('VV-LEFT-AWAIT', 'MK2', 'awaiting_upload', T0 + 10_000_001, null);
  db.insert(approvals).values({ id: 'AV1', workspaceId: ids.workspace, campaignId: id, kind: 'approve_video', subject: { kind: 'video_version', ids: ['VV-OK'], makeVideoApprovalId: 'MK1' }, status: 'pending', createdAt: T0, updatedAt: T0 }).run();
  tx((u) => decideApproveVideo(u, 'AV1', 'approved', {}));

  if (!o.noAccount) {
    db.insert(socialAccounts).values({ id: 'ACC1', workspaceId: ids.workspace, platform: 'facebook', externalId: 'PG1', displayName: 'Trang Bông', status: 'connected', scopes: [], createdAt: T0, updatedAt: T0 }).run();
    db.insert(socialCredentials).values({ accountId: 'ACC1', accessToken: SECRET_TOKEN, updatedAt: T0 }).run();
    if (o.instagram) {
      db.insert(socialAccounts).values({ id: 'IGACC1', workspaceId: ids.workspace, platform: 'instagram', externalId: 'IG1', displayName: '@bongbong', status: 'connected', scopes: [], parentAccountId: 'ACC1', createdAt: T0, updatedAt: T0 }).run();
      db.insert(socialCredentials).values({ accountId: 'IGACC1', accessToken: SECRET_TOKEN, updatedAt: T0 }).run();
    }
  }
  const camp = () => db.select().from(campaigns).where(eq(campaigns.id, id)).get()!;
  const stage = (s: string) => db.select().from(campaignStages).where(and(eq(campaignStages.campaignId, id), eq(campaignStages.stage, s))).get()!;
  const captionTasks = () => db.select().from(tasks).where(and(eq(tasks.campaignId, id), eq(tasks.kind, 'caption'))).all();
  const allPosts = () => db.select().from(posts).where(eq(posts.campaignId, id)).all();
  const post = (platform: string) => allPosts().find((p) => p.platform === platform)!;
  const progress = () => tx((u) => progressCampaign(u, id));
  /** Task caption xong (qua Gateway thật ở test gateway; ở đây chèn thẳng) → Approval approve_publish. */
  const finishCaption = (captions = platforms.map((p) => ({ platform: p, text: `Caption ${p}`, hashtags: ['bongbong', '#tra sua'] }))) => {
    const t = captionTasks().at(-1)!;
    db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, t.id)).run();
    db.insert(artifacts).values({ id: `CAP-${t.id}`, taskId: t.id, campaignId: id, kind: 'caption', content: { text: 'x', captions }, createdAt: now }).run();
    progress();
    return db.select().from(approvals).where(and(eq(approvals.campaignId, id), eq(approvals.kind, 'approve_publish'))).all().at(-1)!;
  };
  const advance = (ms: number) => {
    now += ms;
  };
  return { db, ids, deps, advance, tx, id, platforms, camp, stage, captionTasks, allPosts, post, progress, finishCaption, setStage };
}
