import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MVP_STAGES } from './engine.ts';
import { ApprovalError } from './shared.ts';
import { approvedVideoVersion, cancelPost, decideApprovePublish, markPostPublished, retryPost, settlePublishing } from './publishing.ts';
import { approvals, artifacts, campaignStages, messages, posts, socialAccounts, tasks, videoVersions } from '../db/schema.ts';
import { T0 } from '../test/fixtures.ts';
import { publishingSetup } from '../test/publishing.ts';

const HOUR = 3_600_000;

describe('chiến dịch có bước publishing', () => {
  it('MVP_STAGES có publishing; video duyệt xong → bước đăng chạy, đúng một task caption giao publisher', () => {
    expect(MVP_STAGES).toContain('publishing');
    const s = publishingSetup();
    expect(s.stage('video').status).toBe('done');
    expect(s.stage('publishing').status).toBe('running');
    expect(s.camp()).toMatchObject({ status: 'active', currentStage: 'publishing' });
    const caps = s.captionTasks();
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ requiredRole: 'publisher', assigneeAgentId: 'A-P', status: 'queued', stage: 'publishing' });
    expect(caps[0]!.input).toMatchObject({ platforms: ['facebook', 'instagram', 'tiktok'], script: 'Kịch bản chọn', scriptArtifactId: 'SCR1', videoVersionId: 'VV-OK', video: { durationSeconds: 20, width: 1080, height: 1920 } });
    expect((caps[0]!.input.brief as { product: string }).product).toBe('p');
    s.progress();
    expect(s.captionTasks()).toHaveLength(1);
  });

  it('task caption xong → Approval approve_publish và mỗi nền tảng trong brief một post draft → awaiting_approval', () => {
    const s = publishingSetup({ platforms: ['facebook', 'tiktok'] });
    const a = s.finishCaption();
    expect(s.stage('publishing').status).toBe('awaiting_approval');
    expect(a).toMatchObject({ status: 'pending', kind: 'approve_publish', requestedByAgentId: s.ids.director });
    expect(s.allPosts().map((p) => [p.platform, p.mode, p.status, p.approvalId])).toEqual([
      ['facebook', 'api', 'awaiting_approval', a.id],
      ['tiktok', 'manual', 'awaiting_approval', a.id],
    ]);
    expect(s.post('facebook').caption).toBe('Caption facebook\n\n#bongbong #tra_sua'.replace('tra_sua', 'trasua'));
    expect(s.post('facebook').videoVersionId).toBe('VV-OK');
    // Mỗi chuyển trạng thái post có sự kiện + audit.
    const audit = s.db.$client.prepare("select count(*) n from audit where action = 'post.transition'").get() as { n: number };
    expect(audit.n).toBe(2);
    expect(s.db.select().from(messages).all().some((m) => m.content.includes('Caption đăng'))).toBe(true);
  });

  it('chỉ lấy video_version approved, không lấy ready/awaiting_upload còn sót (kể cả mới hơn)', () => {
    const s = publishingSetup();
    const rows = s.db.select().from(videoVersions).all();
    expect(rows.filter((v) => v.status === 'ready' || v.status === 'awaiting_upload').length).toBeGreaterThanOrEqual(2);
    expect(approvedVideoVersion(s.db, s.id)!.id).toBe('VV-OK');
    s.finishCaption();
    expect(new Set(s.allPosts().map((p) => p.videoVersionId))).toEqual(new Set(['VV-OK']));
    s.db.update(videoVersions).set({ status: 'rejected' }).where(eq(videoVersions.id, 'VV-OK')).run();
    expect(approvedVideoVersion(s.db, s.id)).toBeUndefined();
  });
});

function approved(s: ReturnType<typeof publishingSetup>, decision: Record<string, unknown>, status: 'approved' | 'rejected' | 'changes_requested' = 'approved') {
  const a = s.finishCaption();
  s.tx((u) => decideApprovePublish(u, a.id, status, decision));
  return a;
}
const fb = (caption?: string, enabled = true) => ({ platform: 'facebook', enabled, ...(caption ? { caption } : {}) });
const ig = (caption?: string, enabled = true) => ({ platform: 'instagram', enabled, ...(caption ? { caption } : {}) });
const tt = (caption?: string, enabled = true) => ({ platform: 'tiktok', enabled, ...(caption ? { caption } : {}) });

function rejects(s: ReturnType<typeof publishingSetup>, decision: Record<string, unknown>, match: RegExp) {
  const a = s.finishCaption();
  let err: unknown;
  try {
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', decision));
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ApprovalError);
  expect((err as ApprovalError).code).toBe(400);
  expect((err as ApprovalError).message).toMatch(match);
  // Không đổi gì: approval còn pending, post còn awaiting_approval.
  expect(s.db.select().from(approvals).where(eq(approvals.id, a.id)).get()!.status).toBe('pending');
  expect(s.allPosts().every((p) => p.status === 'awaiting_approval')).toBe(true);
}

describe('quyết định approve_publish', () => {
  it('duyệt đăng ngay: caption đã sửa theo nền tảng; Facebook → publishing (gắn tài khoản), đăng tay → scheduled; bỏ chọn → cancelled', () => {
    const s = publishingSetup();
    approved(s, { posts: [fb('FB đã sửa'), ig(undefined, false), tt('TT đã sửa')], when: { mode: 'now' } });
    expect(s.post('facebook')).toMatchObject({ status: 'publishing', caption: 'FB đã sửa', socialAccountId: 'ACC1', scheduledAt: null });
    expect(s.post('instagram')).toMatchObject({ status: 'cancelled' });
    expect(s.post('tiktok')).toMatchObject({ status: 'scheduled', caption: 'TT đã sửa', mode: 'manual', socialAccountId: null });
    expect(s.stage('publishing').status).toBe('awaiting_approval');
    expect(s.db.select().from(approvals).where(eq(approvals.kind, 'approve_publish')).get()!.status).toBe('approved');
  });

  it('lên lịch: giờ hẹn lưu vào post (Facebook 10 phút–30 ngày, đăng tay chỉ cần tương lai)', () => {
    const s = publishingSetup();
    const at = T0 + 5 * HOUR;
    approved(s, { posts: [fb(), ig(), tt()], when: { mode: 'schedule', at } });
    expect(s.allPosts().map((p) => p.scheduledAt)).toEqual([at, at, at]);
    expect(s.post('facebook').status).toBe('publishing');
    expect(s.post('instagram').status).toBe('scheduled');
  });

  it('giờ hẹn không hợp lệ → 400', () => {
    rejects(publishingSetup(), { posts: [fb()], when: { mode: 'schedule', at: 'mai' } }, /Giờ hẹn không hợp lệ/);
    rejects(publishingSetup(), { posts: [fb()], when: { mode: 'schedule', at: T0 + 60_000 } }, /10 phút đến 30 ngày/);
    rejects(publishingSetup(), { posts: [fb()], when: { mode: 'schedule', at: T0 + 31 * 24 * HOUR } }, /10 phút đến 30 ngày/);
    rejects(publishingSetup({ platforms: ['tiktok'] }), { posts: [tt()], when: { mode: 'schedule', at: T0 - HOUR } }, /tương lai/);
  });

  it('Facebook chưa kết nối / token hết hạn / video sai thông số Reels → 400', () => {
    rejects(publishingSetup({ noAccount: true }), { posts: [fb()], when: { mode: 'now' } }, /chưa kết nối/);
    const exp = publishingSetup();
    exp.db.update(socialAccounts).set({ tokenExpiresAt: T0 - 1 }).run();
    rejects(exp, { posts: [fb()], when: { mode: 'now' } }, /hết hạn/);
    const exp2 = publishingSetup();
    exp2.db.update(socialAccounts).set({ status: 'expired' }).run();
    rejects(exp2, { posts: [fb()], when: { mode: 'now' } }, /hết hạn/);
    rejects(publishingSetup({ probe: { durationSeconds: 120, width: 1080, height: 1920 } }), { posts: [fb()], when: { mode: 'now' } }, /Reels.*120\.0 giây/);
    rejects(publishingSetup({ mime: 'video/quicktime' }), { posts: [fb()], when: { mode: 'now' } }, /chỉ nhận MP4/);
  });

  it('video sai thông số vẫn đăng tay được khi bỏ Facebook; caption rỗng/quá dài/không chọn nền tảng → 400', () => {
    const s = publishingSetup({ mime: 'video/quicktime' });
    approved(s, { posts: [fb(undefined, false), ig(), tt()], when: { mode: 'now' } });
    expect(s.post('instagram').status).toBe('scheduled');
    rejects(publishingSetup(), { posts: [fb('x'.repeat(2201))], when: { mode: 'now' } }, /2200/);
    rejects(publishingSetup(), { posts: [fb(undefined, false), ig(undefined, false), tt(undefined, false)], when: { mode: 'now' } }, /ít nhất một nền tảng/);
    rejects(publishingSetup({ platforms: ['tiktok'] }), { posts: [{ platform: 'instagram', enabled: true }], when: { mode: 'now' } }, /Không có bài đăng cho instagram/);
    const e = publishingSetup({ platforms: ['tiktok'] });
    e.finishCaption([{ platform: 'tiktok', text: '', hashtags: [] }]);
    const a = e.db.select().from(approvals).where(eq(approvals.kind, 'approve_publish')).get()!;
    expect(() => e.tx((u) => decideApprovePublish(u, a.id, 'approved', { posts: [], when: { mode: 'now' } }))).toThrow(/trống/);
  });

  it('từ chối → mọi post cancelled, bước done và chiến dịch completed', () => {
    const s = publishingSetup();
    approved(s, { note: 'Thôi' }, 'rejected');
    expect(s.allPosts().map((p) => p.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(s.stage('publishing').status).toBe('done');
    expect(s.camp().status).toBe('completed');
  });

  it('yêu cầu sửa → post cancelled, bước chạy lại, task caption mới kèm ghi chú; làm lại được vòng 2', () => {
    const s = publishingSetup({ platforms: ['tiktok'] });
    approved(s, { note: 'Hook mạnh hơn' }, 'changes_requested');
    expect(s.allPosts().map((p) => p.status)).toEqual(['cancelled']);
    expect(s.stage('publishing')).toMatchObject({ status: 'running', summary: 'Hook mạnh hơn' });
    const caps = s.captionTasks();
    expect(caps).toHaveLength(2);
    expect(caps[1]!.input.feedback).toBe('Hook mạnh hơn');
    const a2 = s.finishCaption();
    expect(a2.status).toBe('pending');
    expect(s.allPosts().filter((p) => p.status === 'awaiting_approval')).toHaveLength(1);
  });

  it('quyết định lần 2 → 409; approval không phải approve_publish → 400', () => {
    const s = publishingSetup({ platforms: ['tiktok'] });
    const a = approved(s, { posts: [tt()], when: { mode: 'now' } });
    expect(() => s.tx((u) => decideApprovePublish(u, a.id, 'approved', {}))).toThrow(expect.objectContaining({ code: 409 }));
    expect(() => s.tx((u) => decideApprovePublish(u, 'AV1', 'approved', {}))).toThrow(expect.objectContaining({ code: 400 }));
  });
});

describe('bước publishing chỉ done khi mọi post published hoặc cancelled', () => {
  it('scheduled, publishing hoặc failed chưa done; đủ published/cancelled thì done và chiến dịch completed', () => {
    const s = publishingSetup();
    approved(s, { posts: [fb(), ig(), tt(undefined, false)], when: { mode: 'now' } });
    const stage = () => s.stage('publishing').status;
    const camp = () => s.camp().status;
    // instagram scheduled (đăng tay), facebook publishing, tiktok cancelled
    expect(stage()).toBe('awaiting_approval');
    s.tx((u) => markPostPublished(u, s.post('instagram').id, 'https://instagram.com/reel/abc'));
    expect(s.post('instagram')).toMatchObject({ status: 'published', permalink: 'https://instagram.com/reel/abc' });
    expect(stage()).toBe('awaiting_approval'); // facebook còn publishing
    s.tx((u) => u.transition({ entity: 'post', id: s.post('facebook').id, to: 'failed', actor: 'system', ctx: { retries: 0 } }));
    expect(stage()).toBe('awaiting_approval'); // failed
    s.tx((u) => u.transition({ entity: 'post', id: s.post('facebook').id, to: 'publishing', actor: 'system', ctx: { retries: 0 } }));
    s.tx((u) => u.transition({ entity: 'post', id: s.post('facebook').id, to: 'scheduled', actor: 'system', ctx: { retries: 0 } }));
    expect(stage()).toBe('awaiting_approval'); // scheduled ở Meta
    expect(camp()).toBe('active');
    s.tx((u) => u.transition({ entity: 'post', id: s.post('facebook').id, to: 'publishing', actor: 'system', ctx: { retries: 0 } }));
    s.tx((u) => u.transition({ entity: 'post', id: s.post('facebook').id, to: 'published', actor: 'system', ctx: { retries: 0 } }));
    s.tx((u) => settlePublishing(u, s.id)); // worker gọi sau khi ghi published
    expect(stage()).toBe('done');
    expect(camp()).toBe('completed');
  });

  it('bài đăng tay: Đã đăng (link tuỳ chọn, chỉ http/https) và Bỏ; bài cuối xong → done + completed', () => {
    const s = publishingSetup({ platforms: ['instagram', 'tiktok'] });
    approved(s, { posts: [ig(), tt()], when: { mode: 'now' } });
    expect(() => s.tx((u) => markPostPublished(u, s.post('instagram').id, 'javascript:alert(1)'))).toThrow(expect.objectContaining({ code: 400 }));
    expect(() => s.tx((u) => markPostPublished(u, s.post('instagram').id, 'ftp://x'))).toThrow(/http/);
    s.tx((u) => markPostPublished(u, s.post('instagram').id));
    expect(s.post('instagram')).toMatchObject({ status: 'published', permalink: null });
    expect(s.stage('publishing').status).toBe('awaiting_approval');
    s.tx((u) => cancelPost(u, s.post('tiktok').id));
    expect(s.post('tiktok').status).toBe('cancelled');
    expect(s.stage('publishing').status).toBe('done');
    expect(s.camp().status).toBe('completed');
    expect(() => s.tx((u) => markPostPublished(u, s.post('instagram').id))).toThrow(expect.objectContaining({ code: 409 }));
  });

  it('không đánh dấu tay bài Facebook; không huỷ bài Facebook đã được Meta giữ lịch; Thử lại chỉ cho bài failed', () => {
    const s = publishingSetup({ platforms: ['facebook'] });
    approved(s, { posts: [fb()], when: { mode: 'now' } });
    const id = s.post('facebook').id;
    expect(() => s.tx((u) => markPostPublished(u, id))).toThrow(expect.objectContaining({ code: 400 }));
    expect(() => s.tx((u) => retryPost(u, id))).toThrow(expect.objectContaining({ code: 409 }));
    s.tx((u) => u.transition({ entity: 'post', id, to: 'scheduled', actor: 'system', ctx: { retries: 0 } }));
    expect(() => s.tx((u) => cancelPost(u, id))).toThrow(expect.objectContaining({ code: 409 }));
  });
});

describe('Instagram qua API khi có tài khoản IG liên kết', () => {
  const both = (when: Record<string, unknown> = { mode: 'now' }) => ({ posts: [{ platform: 'facebook', enabled: true, caption: 'FB' }, { platform: 'instagram', enabled: true, caption: 'IG #x' }], when });

  it('đăng ngay: bài Instagram chuyển mode api, gắn tài khoản IG, sang publishing', () => {
    const s = publishingSetup({ platforms: ['facebook', 'instagram'], instagram: true });
    const a = s.finishCaption();
    expect(s.post('instagram').mode).toBe('manual');
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', both()));
    expect(s.post('instagram')).toMatchObject({ mode: 'api', socialAccountId: 'IGACC1', status: 'publishing', caption: 'IG #x' });
    expect(s.post('facebook')).toMatchObject({ mode: 'api', socialAccountId: 'ACC1', status: 'publishing' });
  });

  it('không có tài khoản IG → vẫn đăng tay (scheduled, không gắn tài khoản)', () => {
    const s = publishingSetup({ platforms: ['facebook', 'instagram'] });
    const a = s.finishCaption();
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', both()));
    expect(s.post('instagram')).toMatchObject({ mode: 'manual', socialAccountId: null, status: 'scheduled' });
  });

  it('hẹn giờ: Instagram nằm scheduled cục bộ (máy giữ lịch), giờ hẹn chỉ cần ở tương lai; bỏ được', () => {
    const s = publishingSetup({ platforms: ['instagram'], instagram: true });
    const a = s.finishCaption();
    const at = T0 + 2 * 60_000; // dưới 10 phút: hợp lệ với Instagram
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', { posts: [{ platform: 'instagram', enabled: true }], when: { mode: 'schedule', at } }));
    expect(s.post('instagram')).toMatchObject({ mode: 'api', status: 'scheduled', scheduledAt: at });
    s.tx((u) => cancelPost(u, s.post('instagram').id));
    expect(s.post('instagram').status).toBe('cancelled');
  });

  it('video sai thông số Reels → 400 nêu Instagram Reels, không đổi gì', () => {
    const s = publishingSetup({ platforms: ['instagram'], instagram: true, probe: { durationSeconds: 20, width: 1920, height: 1080 } });
    const a = s.finishCaption();
    expect(() => s.tx((u) => decideApprovePublish(u, a.id, 'approved', { posts: [{ platform: 'instagram', enabled: true }], when: { mode: 'now' } }))).toThrow(/Instagram Reels/);
    expect(s.post('instagram')).toMatchObject({ mode: 'manual', status: 'awaiting_approval' });
  });

  it('tài khoản IG hết hạn → đăng tay', () => {
    const s = publishingSetup({ platforms: ['instagram'], instagram: true });
    s.db.update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, 'IGACC1')).run();
    const a = s.finishCaption();
    s.tx((u) => decideApprovePublish(u, a.id, 'approved', { posts: [{ platform: 'instagram', enabled: true }], when: { mode: 'now' } }));
    expect(s.post('instagram').mode).toBe('manual');
  });
});
