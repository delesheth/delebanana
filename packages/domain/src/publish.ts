// Bước đăng (phiếu D): hằng số, kiểm thông số Reels và kiểu dữ liệu bài đăng/tài khoản. Phần thuần, không gọi mạng.

import { ASPECT_TOLERANCE, MIN_VIDEO_HEIGHT, MIN_VIDEO_WIDTH, type VideoProbe } from './videoTools.ts';
import type { Platform } from './lifecycle/campaign.ts';
import type { PostMode, PostStatus } from './lifecycle/post.ts';

/** Hạn mức Reels đăng qua API cho mỗi Page trong 24 giờ cuốn chiếu (docs/product/platform-limits.md). */
export const FB_REELS_DAILY_LIMIT = 30;
/** Hạn mức đăng qua API mỗi tài khoản Instagram / 24 giờ cuốn chiếu: tài liệu Meta ghi 50 lẫn 100, lấy mức thấp. Cần kiểm chứng. */
export const IG_REELS_DAILY_LIMIT = 50;
export const FB_REELS_MIN_SECONDS = 3;
export const FB_REELS_MAX_SECONDS = 90;
export const CAPTION_MAX_LENGTH = 2200;
/** Giờ hẹn Facebook (Meta giữ lịch): sớm nhất 10 phút, muộn nhất 30 ngày kể từ lúc duyệt. Cần kiểm chứng với Graph API. */
export const FB_SCHEDULE_MIN_MS = 10 * 60_000;
export const FB_SCHEDULE_MAX_MS = 30 * 24 * 3_600_000;

/** Nền tảng đăng qua API trong phiếu này; các nền tảng còn lại đăng tay có hỗ trợ. */
export const API_PLATFORMS: readonly Platform[] = ['facebook'];
export const isApiPlatform = (p: string): boolean => (API_PLATFORMS as readonly string[]).includes(p);

/** Trang đăng của nền tảng cho chế độ đăng tay. Cần kiểm chứng: URL có thể đổi. */
export const MANUAL_POST_URLS: Partial<Record<Platform, string>> = {
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/tiktokstudio/upload',
};

export const PLATFORM_LABELS: Record<Platform, string> = { facebook: 'Facebook Reels', instagram: 'Instagram Reels', tiktok: 'TikTok' };

/** Kiểm video trước khi đăng Reels (Facebook hoặc Instagram); trả lý do cụ thể (rỗng = hợp lệ). Không sửa tệp. */
export function checkReelsSpec(probe: VideoProbe | null | undefined, mime: string | null | undefined, label = 'Facebook Reels'): string[] {
  const reasons: string[] = [];
  if (mime !== 'video/mp4') reasons.push(`${label} chỉ nhận MP4, tệp này là ${mime || 'không rõ định dạng'}`);
  const p = probe ?? {};
  const d = p.durationSeconds;
  if (d === undefined) reasons.push('Không có thời lượng của video');
  else if (d < FB_REELS_MIN_SECONDS || d > FB_REELS_MAX_SECONDS) reasons.push(`Thời lượng ${d.toFixed(1)} giây ngoài khoảng Reels cho phép ${FB_REELS_MIN_SECONDS}–${FB_REELS_MAX_SECONDS} giây`);
  if (!p.width || !p.height) reasons.push('Không có độ phân giải của video');
  else {
    const turned = Math.abs((p.rotation ?? 0) % 180) === 90;
    const [w, h] = turned ? [p.height, p.width] : [p.width, p.height];
    if (Math.abs(w / h - 9 / 16) / (9 / 16) > ASPECT_TOLERANCE) reasons.push(`Reels cần tỉ lệ 9:16 (dọc), video là ${w}x${h}`);
    if (w < MIN_VIDEO_WIDTH || h < MIN_VIDEO_HEIGHT) reasons.push(`Độ phân giải ${w}x${h} nhỏ hơn tối thiểu ${MIN_VIDEO_WIDTH}x${MIN_VIDEO_HEIGHT} của Reels`);
  }
  return reasons;
}

/** Bài đăng (không có token hay bí mật). Thời gian ms epoch. */
export interface PostRow {
  id: string;
  campaignId: string;
  approvalId: string | null;
  videoVersionId: string;
  socialAccountId: string | null;
  platform: Platform;
  mode: PostMode;
  caption: string;
  captionArtifactId: string | null;
  status: PostStatus;
  scheduledAt: number | null;
  retries: number;
  platformPostId: string | null;
  permalink: string | null;
  error: string | null;
  publishedAt: number | null;
  remindedAt: number | null;
  /** Đã gửi finish cho Meta lúc này (ms): giờ hẹn không đổi được nữa. */
  finishSentAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type SocialAccountStatus = 'connected' | 'expired';

/** Tài khoản xã hội đã kết nối (token nằm ở bảng riêng, không bao giờ có trong kiểu này). */
export interface SocialAccountRow {
  id: string;
  workspaceId: string;
  platform: Platform;
  externalId: string;
  displayName: string;
  status: SocialAccountStatus;
  tokenExpiresAt: number | null;
  dataAccessExpiresAt: number | null;
  scopes: string[];
  /** Tài khoản Instagram: id tài khoản Facebook Page mà nó liên kết (dùng chung Page token). */
  parentAccountId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Cấu hình app Meta cho giao diện: không trả App Secret. */
export interface MetaAppStatus {
  configured: boolean;
  appId: string | null;
  hasSecret: boolean;
  redirectUri: string;
}

/** Quyết định approve_publish gửi từ giao diện. */
export interface PublishDecision {
  posts: { platform: Platform; enabled: boolean; caption: string }[];
  when: { mode: 'now' } | { mode: 'schedule'; at: number };
}
