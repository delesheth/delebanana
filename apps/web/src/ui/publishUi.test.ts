import { describe, expect, it } from 'vitest';
import { FB_SCHEDULE_MIN_MS, type PostRow } from '@delebanana/domain';
import { accountStatusText, buildPublishDecision, facebookBlockReason, fromDatetimeLocal, instagramBlockReason, oauthStartUrl, postActions, postStatusLabel, toDatetimeLocal, validateRetryWhen, type CaptionDraft } from './publishUi.ts';

const NOW = new Date(2026, 10, 24, 10, 0).getTime();
const drafts = (over: Partial<Record<'facebook' | 'instagram' | 'tiktok', Partial<CaptionDraft>>> = {}): CaptionDraft[] =>
  (['facebook', 'instagram', 'tiktok'] as const).map((platform) => ({ platform, enabled: true, caption: `Cap ${platform}`, ...over[platform] }));

describe('buildPublishDecision', () => {
  it('đăng ngay: gửi caption đã sửa theo từng nền tảng, nền tảng bỏ chọn kèm enabled=false', () => {
    const r = buildPublishDecision(drafts({ instagram: { enabled: false }, tiktok: { caption: '  Sửa  ' } }), { mode: 'now' }, NOW);
    expect(r).toEqual({
      ok: true,
      decision: {
        posts: [
          { platform: 'facebook', enabled: true, caption: 'Cap facebook' },
          { platform: 'instagram', enabled: false, caption: 'Cap instagram' },
          { platform: 'tiktok', enabled: true, caption: 'Sửa' },
        ],
        when: { mode: 'now' },
      },
    });
  });

  it('lên lịch: đổi giờ máy sang ms; Facebook cần ≥ 10 phút, chỉ đăng tay chỉ cần tương lai', () => {
    const at = NOW + 3_600_000;
    const ok = buildPublishDecision(drafts(), { mode: 'schedule', local: toDatetimeLocal(at) }, NOW);
    expect(ok).toMatchObject({ ok: true, decision: { when: { mode: 'schedule', at } } });
    const soon = toDatetimeLocal(NOW + FB_SCHEDULE_MIN_MS - 5 * 60_000);
    expect(buildPublishDecision(drafts(), { mode: 'schedule', local: soon }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('10 phút') });
    expect(buildPublishDecision(drafts({ facebook: { enabled: false } }), { mode: 'schedule', local: soon }, NOW)).toMatchObject({ ok: true });
    expect(buildPublishDecision(drafts({ facebook: { enabled: false } }), { mode: 'schedule', local: toDatetimeLocal(NOW - 60_000) }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('tương lai') });
    expect(buildPublishDecision(drafts(), { mode: 'schedule', local: '' }, NOW)).toMatchObject({ ok: false, reason: 'Chọn giờ hẹn.' });
  });

  it('không chọn nền tảng nào / caption trống / quá 2200 ký tự → lý do cụ thể', () => {
    const none = drafts({ facebook: { enabled: false }, instagram: { enabled: false }, tiktok: { enabled: false } });
    expect(buildPublishDecision(none, { mode: 'now' }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('ít nhất một nền tảng') });
    expect(buildPublishDecision(drafts({ tiktok: { caption: '  ' } }), { mode: 'now' }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('TikTok đang trống') });
    expect(buildPublishDecision(drafts({ facebook: { caption: 'x'.repeat(2201) } }), { mode: 'now' }, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('2201') });
    // nền tảng bỏ chọn không bị kiểm caption
    expect(buildPublishDecision(drafts({ tiktok: { enabled: false, caption: '' } }), { mode: 'now' }, NOW).ok).toBe(true);
  });
});

describe('datetime-local', () => {
  it('khứ hồi theo giờ máy; chuỗi sai → null', () => {
    expect(fromDatetimeLocal(toDatetimeLocal(NOW))).toBe(NOW);
    expect(fromDatetimeLocal('hôm qua')).toBeNull();
    expect(fromDatetimeLocal('')).toBeNull();
  });
});

describe('facebookBlockReason', () => {
  it('chỉ chặn khi Facebook đang được chọn', () => {
    expect(facebookBlockReason(drafts(), { facebookReady: false })).toContain('chưa kết nối');
    expect(facebookBlockReason(drafts({ facebook: { enabled: false } }), { facebookReady: false })).toBeUndefined();
    expect(facebookBlockReason(drafts(), { facebookReady: true, reelsSpecReasons: ['Reels cần tỉ lệ 9:16'] })).toContain('9:16');
    expect(facebookBlockReason(drafts(), { facebookReady: true, reelsSpecReasons: [] })).toBeUndefined();
  });
});

describe('nút trên bài đăng', () => {
  const p = (status: string, mode: string, platform = 'instagram') => ({ status, mode, platform }) as Pick<PostRow, 'status' | 'mode' | 'platform'>;
  it('bài đăng tay chờ đăng: Đã đăng, Bỏ, sao chép/tải/mở trang; bài Facebook lỗi: Thử lại và Bỏ', () => {
    expect(postActions(p('scheduled', 'manual', 'tiktok'), NOW)).toEqual({ retry: false, reschedule: false, markPublished: true, cancel: true, manualHelpers: true, openUrl: 'https://www.tiktok.com/tiktokstudio/upload' });
    expect(postActions(p('scheduled', 'manual', 'instagram'), NOW).openUrl).toContain('instagram.com');
    expect(postActions(p('failed', 'api', 'facebook'), NOW)).toMatchObject({ retry: true, cancel: true, markPublished: false, manualHelpers: false });
  });
  it('Facebook đã được Meta giữ lịch hoặc đang đăng, bài đã xong: không có nút nào', () => {
    for (const s of ['scheduled', 'publishing', 'published', 'cancelled']) expect(postActions(p(s, 'api', 'facebook'), NOW)).toMatchObject({ retry: false, markPublished: false, cancel: false, manualHelpers: false, openUrl: null });
    expect(postActions(p('published', 'manual'), NOW)).toMatchObject({ markPublished: false, cancel: false });
  });
  it('bài Facebook lỗi có giờ hẹn hết hiệu lực (chưa gửi finish): chọn Đăng ngay/đổi giờ thay vì Thử lại thường', () => {
    const f = (scheduledAt: number | null, finishSentAt: number | null = null) => ({ ...p('failed', 'api', 'facebook'), scheduledAt, finishSentAt });
    expect(postActions(f(NOW - 1000), NOW)).toMatchObject({ reschedule: true, retry: false, cancel: true });
    expect(postActions(f(NOW + FB_SCHEDULE_MIN_MS - 1), NOW)).toMatchObject({ reschedule: true, retry: false });
    expect(postActions(f(NOW + FB_SCHEDULE_MIN_MS), NOW)).toMatchObject({ reschedule: false, retry: true });
    expect(postActions(f(null), NOW)).toMatchObject({ reschedule: false, retry: true });
    expect(postActions(f(NOW - 1000, NOW - 5000), NOW)).toMatchObject({ reschedule: false, retry: true }); // Meta đã giữ giờ cũ
    expect(postActions({ ...p('publishing', 'api', 'facebook'), scheduledAt: NOW - 1000, finishSentAt: null }, NOW).reschedule).toBe(false);
  });
  it('validateRetryWhen: giờ mới phải trong 10 phút–30 ngày', () => {
    expect(validateRetryWhen('', NOW)).toMatchObject({ ok: false });
    expect(validateRetryWhen(toDatetimeLocal(NOW + 5 * 60_000), NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('10 phút') });
    expect(validateRetryWhen(toDatetimeLocal(NOW + 31 * 86_400_000), NOW)).toMatchObject({ ok: false });
    expect(validateRetryWhen(toDatetimeLocal(NOW + 2 * 3_600_000), NOW)).toEqual({ ok: true, when: { mode: 'schedule', at: NOW + 2 * 3_600_000 } });
  });
  it('nhãn trạng thái phân biệt đăng tay và lịch Meta', () => {
    expect(postStatusLabel({ status: 'scheduled', mode: 'manual', scheduledAt: null })).toBe('Chờ bạn đăng');
    expect(postStatusLabel({ status: 'scheduled', mode: 'api', scheduledAt: 1 })).toBe('Đã lên lịch ở Meta');
    expect(postStatusLabel({ status: 'failed', mode: 'api', scheduledAt: null })).toBe('Lỗi');
  });
});

describe('trạng thái kết nối', () => {
  it('hiện hạn token và hạn quyền dữ liệu; hết hạn thì nói rõ', () => {
    const day = 86_400_000;
    expect(accountStatusText({ status: 'connected', tokenExpiresAt: null, dataAccessExpiresAt: NOW + 10 * day }, NOW)).toBe('Đã kết nối · token không hết hạn · quyền dữ liệu còn 10 ngày');
    expect(accountStatusText({ status: 'connected', tokenExpiresAt: NOW + 3 * day, dataAccessExpiresAt: null }, NOW)).toBe('Đã kết nối · token còn 3 ngày');
    expect(accountStatusText({ status: 'expired', tokenExpiresAt: null, dataAccessExpiresAt: null }, NOW)).toContain('hết hạn');
  });
  it('URL bắt đầu OAuth chạy thẳng ở cổng server của redirect', () => {
    expect(oauthStartUrl({ redirectUri: 'http://localhost:8787/oauth/facebook/callback' })).toBe('http://localhost:8787/oauth/facebook/start');
  });
});

describe('Instagram qua API', () => {
  it('nhãn scheduled: Instagram API do máy giữ lịch, Facebook ở Meta, đăng tay chờ bạn', () => {
    expect(postStatusLabel({ status: 'scheduled', mode: 'api', platform: 'instagram', scheduledAt: NOW })).toBe('Chờ tới giờ đăng (máy cần bật)');
    expect(postStatusLabel({ status: 'scheduled', mode: 'api', platform: 'facebook', scheduledAt: NOW })).toBe('Đã lên lịch ở Meta');
    expect(postStatusLabel({ status: 'scheduled', mode: 'manual', platform: 'instagram', scheduledAt: NOW })).toBe('Chờ bạn đăng');
  });

  it('bài Instagram API hẹn giờ bỏ được; lỗi giờ hẹn qua không đòi đổi giờ như Facebook', () => {
    expect(postActions({ status: 'scheduled', mode: 'api', platform: 'instagram', scheduledAt: NOW + 3_600_000 }, NOW)).toMatchObject({ cancel: true, markPublished: false, manualHelpers: false });
    expect(postActions({ status: 'failed', mode: 'api', platform: 'instagram', scheduledAt: NOW - 1 }, NOW)).toMatchObject({ retry: true, reschedule: false });
  });

  it('chặn Duyệt đăng khi Instagram đi API mà video sai thông số; đăng tay hoặc bỏ chọn thì không chặn', () => {
    const v = { instagramAccount: '@shop', instagramSpecReasons: ['Reels cần tỉ lệ 9:16'] };
    expect(instagramBlockReason(drafts(), v)).toContain('Instagram Reels');
    expect(instagramBlockReason(drafts({ instagram: { enabled: false } }), v)).toBeUndefined();
    expect(instagramBlockReason(drafts(), { instagramAccount: null, instagramSpecReasons: ['x'] })).toBeUndefined();
  });
});
