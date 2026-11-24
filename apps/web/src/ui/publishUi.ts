// Phần thuần của UI đăng bài (kiểm thử không cần DOM): quyết định duyệt đăng, nhãn trạng thái, nút hành động trên bài.

import {
  CAPTION_MAX_LENGTH,
  FB_SCHEDULE_MAX_MS,
  FB_SCHEDULE_MIN_MS,
  MANUAL_POST_URLS,
  PLATFORM_LABELS,
  type MetaAppStatus,
  type Platform,
  type PostRow,
  type PublishDecision,
  type SocialAccountRow,
} from '@delebanana/domain';

export const platformLabel = (p: string): string => PLATFORM_LABELS[p as Platform] ?? p;

export const POST_STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp',
  awaiting_approval: 'Chờ bạn duyệt',
  scheduled: 'Chờ đăng',
  publishing: 'Đang đăng',
  published: 'Đã đăng',
  draft_uploaded: 'Đã lên nháp',
  failed: 'Lỗi',
  cancelled: 'Đã bỏ',
};

/** Trạng thái hiển thị `scheduled`: đăng tay "Chờ bạn đăng", Facebook "Đã lên lịch ở Meta", Instagram API do máy này giữ lịch. */
export function postStatusLabel(p: Pick<PostRow, 'status' | 'mode' | 'scheduledAt'> & Partial<Pick<PostRow, 'platform'>>): string {
  if (p.status === 'scheduled') return p.mode === 'manual' ? 'Chờ bạn đăng' : p.platform === 'instagram' ? 'Chờ tới giờ đăng (máy cần bật)' : 'Đã lên lịch ở Meta';
  return POST_STATUS_LABEL[p.status] ?? p.status;
}

export interface PostActions {
  retry: boolean;
  /** Bài Facebook lỗi vì giờ hẹn hết hiệu lực: phải chọn Đăng ngay hoặc đổi giờ hẹn rồi mới thử lại. */
  reschedule: boolean;
  markPublished: boolean;
  cancel: boolean;
  /** Đăng tay: sao chép caption, tải video, mở trang đăng của nền tảng. */
  manualHelpers: boolean;
  openUrl: string | null;
}

/** Nút nào hiện trên một bài trong danh sách (khớp luật server: bài Facebook đã được Meta giữ lịch không huỷ được từ đây; bài
 *  Instagram hẹn giờ do máy này giữ nên bỏ được). */
export function postActions(p: Pick<PostRow, 'status' | 'mode' | 'platform'> & Partial<Pick<PostRow, 'scheduledAt' | 'finishSentAt'>>, now: number): PostActions {
  const manualOpen = p.mode === 'manual' && p.status === 'scheduled';
  const failedApi = p.mode === 'api' && p.status === 'failed';
  const igWaiting = p.mode === 'api' && p.platform === 'instagram' && p.status === 'scheduled';
  // Khớp retryPost ở server: bài Facebook chưa gửi finish + giờ hẹn đã qua/còn dưới 10 phút thì Thử lại thường bị từ chối.
  const reschedule = failedApi && p.platform === 'facebook' && !p.finishSentAt && p.scheduledAt != null && p.scheduledAt < now + FB_SCHEDULE_MIN_MS;
  return {
    retry: failedApi && !reschedule,
    reschedule,
    markPublished: manualOpen,
    cancel: manualOpen || failedApi || igWaiting,
    manualHelpers: manualOpen,
    openUrl: manualOpen ? (MANUAL_POST_URLS[p.platform] ?? null) : null,
  };
}

export const postVideoDownloadUrl = (versionId: string) => `/api/videos/${encodeURIComponent(versionId)}/file?download=1`;

/** Giá trị cho `<input type="datetime-local">` (giờ máy) từ ms epoch. */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ngược lại: chuỗi datetime-local (giờ máy) → ms epoch; không đọc được → null. */
export function fromDatetimeLocal(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const t = new Date(y, mo - 1, d, h, mi).getTime();
  return Number.isFinite(t) ? t : null;
}

export interface CaptionDraft {
  platform: Platform;
  enabled: boolean;
  caption: string;
}
export type WhenDraft = { mode: 'now' } | { mode: 'schedule'; local: string };

export type BuiltDecision = { ok: true; decision: PublishDecision } | { ok: false; reason: string };

/** Kiểm phía giao diện (server kiểm lại) và dựng quyết định duyệt đăng. */
export function buildPublishDecision(drafts: CaptionDraft[], when: WhenDraft, now: number): BuiltDecision {
  const chosen = drafts.filter((d) => d.enabled);
  if (chosen.length === 0) return { ok: false, reason: 'Chọn ít nhất một nền tảng để đăng (hoặc bấm Từ chối).' };
  for (const d of chosen) {
    const len = d.caption.trim().length;
    if (len === 0) return { ok: false, reason: `Caption ${platformLabel(d.platform)} đang trống.` };
    if (len > CAPTION_MAX_LENGTH) return { ok: false, reason: `Caption ${platformLabel(d.platform)} dài ${len} ký tự, tối đa ${CAPTION_MAX_LENGTH}.` };
  }
  let w: PublishDecision['when'] = { mode: 'now' };
  if (when.mode === 'schedule') {
    const at = fromDatetimeLocal(when.local);
    if (at === null) return { ok: false, reason: 'Chọn giờ hẹn.' };
    if (chosen.some((d) => d.platform === 'facebook') && (at < now + FB_SCHEDULE_MIN_MS || at > now + FB_SCHEDULE_MAX_MS))
      return { ok: false, reason: 'Giờ hẹn Facebook phải từ 10 phút đến 30 ngày kể từ bây giờ.' };
    if (at <= now) return { ok: false, reason: 'Giờ hẹn phải ở tương lai.' };
    w = { mode: 'schedule', at };
  }
  return { ok: true, decision: { posts: drafts.map((d) => ({ platform: d.platform, enabled: d.enabled, caption: d.caption.trim() })), when: w } };
}

export type RetryWhen = { mode: 'now' } | { mode: 'schedule'; at: number };
export type BuiltRetryWhen = { ok: true; when: RetryWhen } | { ok: false; reason: string };

/** Kiểm giờ hẹn mới (chuỗi datetime-local) khi đổi giờ rồi Thử lại; server kiểm lại. */
export function validateRetryWhen(local: string, now: number): BuiltRetryWhen {
  const at = fromDatetimeLocal(local);
  if (at === null) return { ok: false, reason: 'Chọn giờ hẹn.' };
  if (at < now + FB_SCHEDULE_MIN_MS || at > now + FB_SCHEDULE_MAX_MS) return { ok: false, reason: 'Giờ hẹn Facebook phải từ 10 phút đến 30 ngày kể từ bây giờ.' };
  return { ok: true, when: { mode: 'schedule', at } };
}

/** Lý do chặn nút Duyệt đăng khi chọn Facebook mà chưa đăng được (chưa kết nối, token hết hạn, video sai thông số). */
export function facebookBlockReason(drafts: CaptionDraft[], v: { facebookReady?: boolean; reelsSpecReasons?: string[] }): string | undefined {
  if (!drafts.some((d) => d.platform === 'facebook' && d.enabled)) return undefined;
  if (v.facebookReady === false) return 'Facebook chưa kết nối hoặc token đã hết hạn — mở "Kết nối tài khoản" ở cuối danh sách Campaign.';
  if (v.reelsSpecReasons && v.reelsSpecReasons.length > 0) return `Video không đăng được lên Facebook Reels: ${v.reelsSpecReasons.join('; ')}.`;
  return undefined;
}

/** Lý do chặn nút Duyệt đăng khi Instagram sẽ đăng qua API mà video sai thông số Reels. */
export function instagramBlockReason(drafts: CaptionDraft[], v: { instagramAccount?: string | null; instagramSpecReasons?: string[] }): string | undefined {
  if (!v.instagramAccount || !drafts.some((d) => d.platform === 'instagram' && d.enabled)) return undefined;
  if (v.instagramSpecReasons && v.instagramSpecReasons.length > 0) return `Video không đăng được lên Instagram Reels: ${v.instagramSpecReasons.join('; ')}.`;
  return undefined;
}

const DAY = 86_400_000;

/** Dòng trạng thái của một tài khoản đã kết nối: kết nối/hết hạn và hạn token. */
export function accountStatusText(a: Pick<SocialAccountRow, 'status' | 'tokenExpiresAt' | 'dataAccessExpiresAt'>, now: number): string {
  if (a.status === 'expired') return 'Token đã hết hạn — kết nối lại';
  const days = (t: number) => Math.max(0, Math.ceil((t - now) / DAY));
  const parts = ['Đã kết nối', a.tokenExpiresAt == null ? 'token không hết hạn' : `token còn ${days(a.tokenExpiresAt)} ngày`];
  if (a.dataAccessExpiresAt != null) parts.push(`quyền dữ liệu còn ${days(a.dataAccessExpiresAt)} ngày`);
  return parts.join(' · ');
}

/** URL mở cửa sổ Facebook Login: chạy thẳng ở cổng server (redirect Meta phải khớp `localhost:<cổng server>`), không qua proxy của web. */
export function oauthStartUrl(app: Pick<MetaAppStatus, 'redirectUri'>): string {
  return `${new URL(app.redirectUri).origin}/oauth/facebook/start`;
}

/** Bài còn việc cần bạn làm hoặc đang chạy (để hiện huy hiệu). */
export const postNeedsAttention = (p: Pick<PostRow, 'status'>): boolean => p.status === 'failed' || p.status === 'scheduled' || p.status === 'publishing';
