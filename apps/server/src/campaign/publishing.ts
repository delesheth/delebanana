// Bước đăng (phiếu D): viết caption → Approval approve_publish → bài đăng theo máy trạng thái post → bước done khi mọi bài
// đã đăng hoặc bị bỏ. Chỉ chạy trong `runTx`; phần gọi mạng nằm ở publish/worker.ts, không ở đây.

import {
  CAPTION_MAX_LENGTH,
  FB_SCHEDULE_MAX_MS,
  FB_SCHEDULE_MIN_MS,
  MAX_PUBLISH_RETRIES,
  checkReelsSpec,
  isApiPlatform,
  type Platform,
  type PublishDecision,
  type VideoProbe,
} from '@delebanana/domain';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { notifyDirector } from '../agents/usage.ts';
import type { DbLike, UnitOfWork } from '../core/unitOfWork.ts';
import { approvals, artifacts, campaignStages, campaigns, posts, socialAccounts, tasks, videoVersions } from '../db/schema.ts';
import { newId } from '../ids.ts';
import { ApprovalError, advance, roleAgent, stageOf, type CampaignRow, type StageRow } from './shared.ts';

type VideoVersionRow = typeof videoVersions.$inferSelect;
type PostDbRow = typeof posts.$inferSelect;

const PLATFORMS: Platform[] = ['facebook', 'instagram', 'tiktok'];
/** Hai trạng thái kết thúc của một bài; bước đăng chỉ xong khi mọi bài đều ở một trong hai. */
const SETTLED = ['published', 'cancelled'];

/**
 * Video dùng để đăng: chỉ phiên bản `approved` của chiến dịch (mới nhất). Sau khi duyệt, các phiên bản ready/awaiting_upload
 * khác còn nằm lại — không bao giờ đọc theo status ready.
 */
export function approvedVideoVersion(tx: DbLike, campaignId: string): VideoVersionRow | undefined {
  return tx
    .select()
    .from(videoVersions)
    .where(and(eq(videoVersions.campaignId, campaignId), eq(videoVersions.status, 'approved')))
    .orderBy(desc(videoVersions.updatedAt), desc(videoVersions.number))
    .get();
}

function briefPlatforms(c: CampaignRow): Platform[] {
  const raw = Array.isArray((c.brief as { platforms?: unknown }).platforms) ? ((c.brief as { platforms: unknown[] }).platforms as unknown[]) : [];
  const out = PLATFORMS.filter((p) => raw.includes(p));
  return out.length > 0 ? out : ['facebook'];
}

/** Một task caption giao Publisher: input gồm kịch bản đã chọn, brief và metadata của phiên bản video đã duyệt. */
export function createCaptionTask(u: UnitOfWork, c: CampaignRow, feedback?: string): void {
  const video = approvedVideoVersion(u.tx, c.id);
  if (!video) return;
  const prompt = u.tx.select({ content: artifacts.content }).from(artifacts).where(eq(artifacts.id, video.videoId)).get();
  const scriptId = (prompt?.content as { scriptArtifactId?: string | null } | undefined)?.scriptArtifactId ?? null;
  const script = scriptId ? u.tx.select({ content: artifacts.content }).from(artifacts).where(eq(artifacts.id, scriptId)).get() : undefined;
  const publisher = roleAgent(u.tx, c.workspaceId, 'publisher');
  const id = newId();
  const platforms = briefPlatforms(c);
  u.tx
    .insert(tasks)
    .values({
      id,
      campaignId: c.id,
      stage: 'publishing',
      kind: 'caption',
      requiredRole: 'publisher',
      assigneeAgentId: publisher?.id,
      input: {
        title: 'Viết caption và hashtag',
        instructions: 'Viết caption và hashtag riêng cho từng nền tảng, từ kịch bản đã chọn, brief và video đã duyệt.',
        platforms,
        brief: c.brief,
        scriptArtifactId: scriptId,
        script: (script?.content as { text?: string } | undefined)?.text ?? null,
        videoVersionId: video.id,
        video: { number: video.number, mime: video.mime, sizeBytes: video.sizeBytes, ...(video.metadata ?? {}) },
        ...(feedback ? { feedback } : {}),
      },
      dependsOn: [],
      status: 'queued',
      createdAt: u.now,
      updatedAt: u.now,
    })
    .run();
  u.emit({ type: 'task.created', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'task', id }, actor: 'system', data: { kind: 'caption', stage: 'publishing', requiredRole: 'publisher', dependsOn: [] } });
  u.touchAgents([publisher?.id]);
}

/** Ghép caption + hashtag thành văn bản đăng; hashtag chuẩn hoá về dạng `#tu_khoa`. */
export function composeCaption(text: string, hashtags: unknown): string {
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((h) => String(h).trim().replace(/^#+/, '').replace(/\s+/g, ''))
    .filter(Boolean)
    .map((h) => `#${h}`);
  const base = text.trim();
  return tags.length > 0 ? `${base}\n\n${[...new Set(tags)].join(' ')}` : base;
}

/**
 * Gọi từ `progressCampaign` khi bước đăng đang chạy và không còn task mở. Task caption của vòng này xong → bước chờ duyệt, mỗi nền
 * tảng trong brief có một post draft → awaiting_approval và một Approval approve_publish. Trả true nếu đã xử lý.
 */
export function progressPublishing(u: UnitOfWork, c: CampaignRow, stage: StageRow, stageTasks: (typeof tasks.$inferSelect)[]): boolean {
  const done = stageTasks.filter((t) => t.kind === 'caption' && t.status === 'done' && t.createdAt >= (stage.startedAt ?? 0)).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!done) return false;
  const video = approvedVideoVersion(u.tx, c.id);
  const art = u.tx.select().from(artifacts).where(and(eq(artifacts.taskId, done.id), eq(artifacts.kind, 'caption'))).orderBy(desc(artifacts.createdAt)).get();
  if (!video || !art) return false;
  const captions = ((art.content as { captions?: { platform: Platform; text: string; hashtags?: string[] }[] }).captions ?? []);
  const director = roleAgent(u.tx, c.workspaceId, 'director');
  u.transition({ entity: 'stage', id: stage.id, to: 'awaiting_approval', actor: 'system' });
  const approvalId = newId();
  const postIds: string[] = [];
  const platforms = (Array.isArray(done.input.platforms) ? done.input.platforms : briefPlatforms(c)) as Platform[];
  for (const platform of platforms) {
    const cap = captions.find((x) => x.platform === platform);
    const id = newId();
    postIds.push(id);
    u.tx
      .insert(posts)
      .values({
        id,
        campaignId: c.id,
        approvalId,
        videoVersionId: video.id,
        platform,
        mode: isApiPlatform(platform) ? 'api' : 'manual',
        caption: cap ? composeCaption(cap.text, cap.hashtags) : '',
        captionArtifactId: art.id,
        status: 'draft',
        createdAt: u.now,
        updatedAt: u.now,
      })
      .run();
    u.transition({ entity: 'post', id, to: 'awaiting_approval', actor: 'system' });
  }
  const subject = { kind: 'post', ids: postIds, videoVersionId: video.id, captionArtifactId: art.id };
  u.tx.insert(approvals).values({ id: approvalId, workspaceId: c.workspaceId, campaignId: c.id, kind: 'approve_publish', subject, requestedByAgentId: director?.id, status: 'pending', createdAt: u.now, updatedAt: u.now }).run();
  u.emit({ type: 'approval.requested', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'approval', id: approvalId }, actor: 'system', data: { kind: 'approve_publish', subject: { kind: 'post', ids: postIds } } });
  u.touchAgents([director?.id]);
  notifyDirector(u, c.workspaceId, `Caption đăng cho "${c.title}" đã sẵn sàng. Mở mục "Chờ bạn duyệt" để sửa, chọn nền tảng và giờ đăng.`, c.id);
  return true;
}

/** Tài khoản của nền tảng dùng được ngay (đã kết nối, token và quyền truy cập dữ liệu còn hạn). */
export function usableAccount(tx: DbLike, workspaceId: string, platform: 'facebook' | 'instagram', now: number) {
  return tx
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, workspaceId), eq(socialAccounts.platform, platform), eq(socialAccounts.status, 'connected')))
    .orderBy(desc(socialAccounts.updatedAt))
    .all()
    .find((a) => !a.archivedAt && (a.tokenExpiresAt == null || a.tokenExpiresAt > now) && (a.dataAccessExpiresAt == null || a.dataAccessExpiresAt > now));
}

function parseWhen(raw: unknown): PublishDecision['when'] {
  const when = raw as { mode?: unknown; at?: unknown } | undefined | null;
  if (when && when.mode === 'schedule') {
    if (typeof when.at !== 'number' || !Number.isFinite(when.at)) throw new ApprovalError(400, 'Giờ hẹn không hợp lệ');
    return { mode: 'schedule', at: when.at };
  }
  if (when && when.mode !== 'now') throw new ApprovalError(400, 'when.mode phải là now hoặc schedule');
  return { mode: 'now' };
}

/** Giờ hẹn Meta giữ lịch: từ 10 phút đến 30 ngày kể từ `now`. */
function checkFacebookSchedule(at: number, now: number): void {
  if (at < now + FB_SCHEDULE_MIN_MS || at > now + FB_SCHEDULE_MAX_MS) throw new ApprovalError(400, 'Giờ hẹn Facebook phải từ 10 phút đến 30 ngày kể từ bây giờ');
}

/** Giờ hẹn theo bài: Facebook qua API do Meta giữ lịch (10 phút – 30 ngày); Instagram API và đăng tay do máy này giữ lịch (chỉ cần ở tương lai). */
function checkSchedule(platform: string, mode: string, at: number, now: number): void {
  if (mode === 'api' && platform === 'facebook') checkFacebookSchedule(at, now);
  else if (at <= now) throw new ApprovalError(400, 'Giờ hẹn phải ở tương lai');
}

function validateDecision(decision: Record<string, unknown>): PublishDecision {
  const rawPosts = decision.posts;
  if (rawPosts !== undefined && !Array.isArray(rawPosts)) throw new ApprovalError(400, 'posts phải là mảng');
  const w = parseWhen(decision.when);
  const list = ((rawPosts ?? []) as { platform?: unknown; enabled?: unknown; caption?: unknown }[]).map((p) => {
    if (!PLATFORMS.includes(p?.platform as Platform)) throw new ApprovalError(400, `Nền tảng không hợp lệ: ${String(p?.platform)}`);
    return { platform: p.platform as Platform, enabled: p.enabled !== false, caption: typeof p.caption === 'string' ? p.caption : '' };
  });
  return { posts: list, when: w };
}

/**
 * Quyết định approve_publish. Duyệt: nhận caption đã sửa theo từng nền tảng, tập nền tảng được chọn, đăng ngay/giờ hẹn; nền tảng
 * bỏ chọn → cancelled. Facebook sang `publishing` (worker upload; lên lịch thì Meta giữ lịch). Instagram có tài khoản IG dùng được
 * thì chuyển `mode='api'`: đăng ngay → `publishing`, hẹn giờ → `scheduled` (máy này giữ lịch). Đăng tay sang `scheduled`.
 * Từ chối: mọi bài cancelled. Yêu cầu sửa: bài cancelled, task caption mới. Sai → ApprovalError 400, không đổi gì.
 */
export function decideApprovePublish(u: UnitOfWork, approvalId: string, status: 'approved' | 'rejected' | 'changes_requested', rawDecision: Record<string, unknown>): void {
  const a = u.tx.select().from(approvals).where(eq(approvals.id, approvalId)).get();
  if (!a) throw new ApprovalError(404, `Không có yêu cầu duyệt ${approvalId}`);
  if (a.kind !== 'approve_publish') throw new ApprovalError(400, 'Không phải yêu cầu duyệt đăng');
  if (a.status !== 'pending') throw new ApprovalError(409, 'Yêu cầu này đã được quyết định');
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, a.campaignId!)).get()!;
  const rows = u.tx.select().from(posts).where(eq(posts.approvalId, a.id)).orderBy(asc(posts.createdAt)).all();

  if (status === 'approved') {
    const d = validateDecision(rawDecision);
    for (const p of d.posts) if (!rows.some((r) => r.platform === p.platform)) throw new ApprovalError(400, `Không có bài đăng cho ${p.platform} trong yêu cầu này`);
    const plan = rows.map((r) => {
      const given = d.posts.find((p) => p.platform === r.platform);
      return { row: r, enabled: given ? given.enabled : true, caption: (given && given.caption !== '' ? given.caption : r.caption).trim() };
    });
    const chosen = plan.filter((p) => p.enabled);
    if (chosen.length === 0) throw new ApprovalError(400, 'Phải chọn ít nhất một nền tảng để đăng (hoặc chọn Từ chối)');
    for (const p of chosen) {
      if (!p.caption) throw new ApprovalError(400, `Caption ${p.row.platform} đang trống`);
      if (p.caption.length > CAPTION_MAX_LENGTH) throw new ApprovalError(400, `Caption ${p.row.platform} dài ${p.caption.length} ký tự, tối đa ${CAPTION_MAX_LENGTH}`);
    }
    // Instagram đi API khi đã có tài khoản IG dùng được lúc duyệt; không có thì vẫn đăng tay.
    const ig = chosen.some((p) => p.row.platform === 'instagram') ? usableAccount(u.tx, c.workspaceId, 'instagram', u.now) : undefined;
    const modeOf = (r: PostDbRow): string => (r.platform === 'instagram' ? (ig ? 'api' : 'manual') : r.mode);
    if (d.when.mode === 'schedule') for (const p of chosen) checkSchedule(p.row.platform, modeOf(p.row), d.when.at, u.now);
    const video = u.tx.select().from(videoVersions).where(eq(videoVersions.id, rows[0]?.videoVersionId ?? '')).get();
    if (!video || video.status !== 'approved') throw new ApprovalError(400, 'Video của bài đăng chưa được duyệt');
    const accountOf: Partial<Record<string, string>> = {};
    if (chosen.some((p) => p.row.platform === 'facebook')) {
      const account = usableAccount(u.tx, c.workspaceId, 'facebook', u.now);
      if (!account) throw new ApprovalError(400, 'Facebook chưa kết nối hoặc token đã hết hạn — vào màn Kết nối tài khoản');
      const reasons = checkReelsSpec((video.metadata ?? {}) as VideoProbe, video.mime);
      if (reasons.length > 0) throw new ApprovalError(400, `Video không đạt thông số Facebook Reels: ${reasons.join('; ')}`);
      accountOf.facebook = account.id;
    }
    if (ig) {
      const reasons = checkReelsSpec((video.metadata ?? {}) as VideoProbe, video.mime, 'Instagram Reels');
      if (reasons.length > 0) throw new ApprovalError(400, `Video không đạt thông số Instagram Reels: ${reasons.join('; ')}`);
      accountOf.instagram = ig.id;
    }
    u.tx.update(approvals).set({ decision: { posts: plan.map((p) => ({ platform: p.row.platform, enabled: p.enabled, caption: p.caption })), when: d.when } }).where(eq(approvals.id, a.id)).run();
    u.transition({ entity: 'approval', id: a.id, to: 'approved', actor: 'user', data: { decision: { when: d.when, platforms: chosen.map((p) => p.row.platform) } } });
    for (const p of plan) {
      if (!p.enabled) {
        u.transition({ entity: 'post', id: p.row.id, to: 'cancelled', actor: 'user', ctx: { retries: p.row.retries, mode: p.row.mode } });
        continue;
      }
      const scheduledAt = d.when.mode === 'schedule' ? d.when.at : null;
      const mode = modeOf(p.row);
      u.tx
        .update(posts)
        .set({ caption: p.caption, scheduledAt, mode, socialAccountId: mode === 'api' ? (accountOf[p.row.platform] ?? null) : null })
        .where(eq(posts.id, p.row.id))
        .run();
      // Instagram API hẹn giờ: máy này giữ lịch (worker đưa sang publishing khi tới giờ).
      const to = mode === 'api' && !(p.row.platform === 'instagram' && scheduledAt != null) ? 'publishing' : 'scheduled';
      u.transition({ entity: 'post', id: p.row.id, to, actor: 'system', ctx: { retries: 0, mode } });
    }
    settlePublishing(u, c.id);
    return;
  }

  u.tx.update(approvals).set({ decision: rawDecision }).where(eq(approvals.id, a.id)).run();
  u.transition({ entity: 'approval', id: a.id, to: status, actor: 'user', data: { decision: rawDecision } });
  for (const r of rows) u.transition({ entity: 'post', id: r.id, to: 'cancelled', actor: 'user', ctx: { retries: r.retries, mode: r.mode } });
  const stage = stageOf(u.tx, c.id, 'publishing');
  if (status === 'changes_requested') {
    u.transition({ entity: 'stage', id: stage.id, to: 'running', actor: 'system' });
    const note = typeof rawDecision.note === 'string' && rawDecision.note.trim() ? rawDecision.note.trim() : undefined;
    u.tx.update(campaignStages).set({ startedAt: u.now, summary: note ?? null }).where(eq(campaignStages.id, stage.id)).run();
    createCaptionTask(u, c, note);
    return;
  }
  settlePublishing(u, c.id);
}

/**
 * Mọi bài của chiến dịch là published hoặc cancelled → bước đăng done (và chiến dịch completed). Còn bài scheduled, publishing,
 * failed (hoặc đang chờ duyệt) thì bước chưa done. Gọi sau mọi chỗ đổi trạng thái bài.
 */
export function settlePublishing(u: UnitOfWork, campaignId: string): void {
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!c || c.status !== 'active') return;
  const stage = stageOf(u.tx, campaignId, 'publishing');
  if (stage.status !== 'awaiting_approval') return;
  const rows = u.tx.select({ status: posts.status }).from(posts).where(eq(posts.campaignId, campaignId)).all();
  if (rows.length === 0 || rows.some((r) => !SETTLED.includes(r.status))) return;
  const open = u.tx.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.campaignId, campaignId), eq(approvals.kind, 'approve_publish'), eq(approvals.status, 'pending'))).get();
  if (open) return;
  advance(u, c, stage);
}

function postOf(tx: DbLike, id: string): PostDbRow {
  const p = tx.select().from(posts).where(eq(posts.id, id)).get();
  if (!p) throw new ApprovalError(404, `Không có bài đăng ${id}`);
  return p;
}

/**
 * Nút Thử lại của người dùng: failed → publishing, đếm lại lượt tự thử lại từ 0. `when` (tuỳ chọn) đổi giờ đăng trước khi thử lại.
 * Bài chưa gửi finish mà giờ hẹn đã qua/còn dưới 10 phút phải kèm `when`; bài đã gửi finish thì Meta giữ giờ cũ (chỉ hỏi lại trạng thái).
 */
export function retryPost(u: UnitOfWork, postId: string, rawWhen?: unknown): void {
  const p = postOf(u.tx, postId);
  if (p.status !== 'failed') throw new ApprovalError(409, 'Chỉ bài đăng lỗi mới thử lại được');
  if (p.mode !== 'api') throw new ApprovalError(400, 'Bài đăng tay không có bước thử lại');
  let scheduledAt = p.scheduledAt;
  if (rawWhen != null) {
    if (p.finishSentAt) throw new ApprovalError(409, 'Meta đã nhận video với giờ hẹn cũ — không đổi giờ từ đây');
    const w = parseWhen(rawWhen);
    if (w.mode === 'schedule') checkSchedule(p.platform, p.mode, w.at, u.now);
    scheduledAt = w.mode === 'schedule' ? w.at : null;
  } else if (p.platform === 'facebook' && !p.finishSentAt && scheduledAt != null && scheduledAt < u.now + FB_SCHEDULE_MIN_MS) {
    throw new ApprovalError(400, 'Giờ hẹn đã qua hoặc còn dưới 10 phút — chọn Đăng ngay hoặc đổi giờ hẹn');
  }
  u.tx.update(posts).set({ error: null, retries: 0, scheduledAt, ...(p.finishSentAt ? { finishRetriedAt: u.now } : {}) }).where(eq(posts.id, p.id)).run();
  u.transition({ entity: 'post', id: p.id, to: 'publishing', actor: 'user', ctx: { retries: 0, mode: p.mode } });
}

/** Đánh dấu đã đăng (chỉ bài đăng tay đang chờ đăng); link bài là http/https, tuỳ chọn. */
export function markPostPublished(u: UnitOfWork, postId: string, link?: string): void {
  const p = postOf(u.tx, postId);
  if (p.mode !== 'manual') throw new ApprovalError(400, 'Chỉ bài đăng tay mới đánh dấu đã đăng');
  if (p.status !== 'scheduled') throw new ApprovalError(409, 'Bài này không ở trạng thái chờ đăng');
  let permalink: string | null = null;
  if (link !== undefined && link.trim() !== '') {
    try {
      const url = new URL(link.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      permalink = url.toString();
    } catch {
      throw new ApprovalError(400, 'Link bài đăng phải bắt đầu bằng http:// hoặc https://');
    }
  }
  u.tx.update(posts).set({ permalink, publishedAt: u.now }).where(eq(posts.id, p.id)).run();
  u.transition({ entity: 'post', id: p.id, to: 'published', actor: 'user', ctx: { retries: p.retries, mode: p.mode } });
  settlePublishing(u, p.campaignId);
}

/**
 * Bỏ một bài chưa đăng. Bài Facebook đã được Meta giữ lịch (`scheduled`) không huỷ được từ đây (API không bảo đảm xoá lịch):
 * phải huỷ trong Meta Business Suite.
 */
export function cancelPost(u: UnitOfWork, postId: string): void {
  const p = postOf(u.tx, postId);
  // Instagram hẹn giờ do máy này giữ lịch (chưa gửi gì cho Meta) nên bỏ được.
  if (p.mode === 'api' && p.status === 'scheduled' && p.platform !== 'instagram') throw new ApprovalError(409, 'Bài đã được Meta giữ lịch — huỷ trong Meta Business Suite (Facebook chưa cho huỷ lịch từ đây)');
  if (!['draft', 'awaiting_approval', 'scheduled', 'failed'].includes(p.status)) throw new ApprovalError(409, 'Bài này không bỏ được ở trạng thái hiện tại');
  u.transition({ entity: 'post', id: p.id, to: 'cancelled', actor: 'user', ctx: { retries: p.retries, mode: p.mode } });
  settlePublishing(u, p.campaignId);
}

/** Dữ liệu kèm Approval approve_publish cho giao diện: bài đăng, video và trạng thái kết nối Facebook/Instagram (không có token). */
export function publishApprovalView(db: DbLike, a: { subject: Record<string, unknown>; workspaceId: string }, now: number) {
  const ids = Array.isArray(a.subject.ids) ? (a.subject.ids as string[]) : [];
  const rows = ids.length > 0 ? db.select().from(posts).where(inArray(posts.id, ids)).orderBy(asc(posts.createdAt)).all() : [];
  const v = db.select().from(videoVersions).where(eq(videoVersions.id, String(a.subject.videoVersionId ?? ''))).get();
  const spec = v ? checkReelsSpec((v.metadata ?? {}) as VideoProbe, v.mime) : ['Không có video'];
  return {
    posts: rows,
    video: v ? { id: v.id, number: v.number, mime: v.mime, sizeBytes: v.sizeBytes, metadata: v.metadata } : null,
    facebookReady: usableAccount(db, a.workspaceId, 'facebook', now) !== undefined,
    reelsSpecReasons: spec,
    /** Tài khoản IG dùng được: có thì bài Instagram tự đăng qua API, không thì đăng tay. */
    instagramAccount: usableAccount(db, a.workspaceId, 'instagram', now)?.displayName ?? null,
    instagramSpecReasons: v ? checkReelsSpec((v.metadata ?? {}) as VideoProbe, v.mime, 'Instagram Reels') : ['Không có video'],
    retryLimit: MAX_PUBLISH_RETRIES,
  };
}
