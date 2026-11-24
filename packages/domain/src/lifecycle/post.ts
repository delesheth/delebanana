// Vòng đời bài đăng — mục 4.5.

import { defineMachine } from '../machine.ts';

export type PostStatus = 'draft' | 'awaiting_approval' | 'scheduled' | 'publishing' | 'published' | 'draft_uploaded' | 'failed' | 'cancelled';

/** Số lần hệ thống tự đăng lại sau lỗi; quá thì chỉ người dùng thử lại. */
export const MAX_PUBLISH_RETRIES = 3;

export type PostMode = 'api' | 'manual';

export const postMachine = defineMachine<PostStatus, { retries: number; mode?: PostMode }>({
  name: 'post',
  states: ['draft', 'awaiting_approval', 'scheduled', 'publishing', 'published', 'draft_uploaded', 'failed', 'cancelled'],
  terminal: ['published', 'draft_uploaded', 'cancelled'],
  transitions: [
    { from: 'draft', to: 'awaiting_approval', by: ['system'] },
    { from: 'awaiting_approval', to: 'scheduled', by: ['system'] },
    { from: 'awaiting_approval', to: 'publishing', by: ['system'] },
    { from: 'scheduled', to: 'publishing', by: ['system'] },
    // API đã nhận video và Meta giữ lịch (video_state SCHEDULED): chờ tới giờ.
    { from: 'publishing', to: 'scheduled', by: ['system'] },
    { from: 'publishing', to: 'published', by: ['system'] },
    // Đến giờ Meta đăng (system xác nhận), hoặc người dùng bấm "Đã đăng" cho bài đăng tay (chỉ mode manual).
    {
      from: 'scheduled',
      to: 'published',
      by: ['system', 'user'],
      guard: (ctx, by) => (by === 'user' && ctx.mode !== 'manual' ? 'chỉ bài đăng tay mới được đánh dấu đã đăng' : null),
    },
    { from: 'publishing', to: 'draft_uploaded', by: ['system'] },
    { from: 'publishing', to: 'failed', by: ['system'] },
    {
      from: 'failed',
      to: 'publishing',
      by: ['system', 'user'],
      guard: (ctx, by) => (by === 'system' && ctx.retries >= MAX_PUBLISH_RETRIES ? 'hết lượt tự đăng lại, chờ người dùng' : null),
    },
    { from: 'draft', to: 'cancelled', by: ['user', 'system'] },
    { from: 'awaiting_approval', to: 'cancelled', by: ['user', 'system'] },
    { from: 'scheduled', to: 'cancelled', by: ['user', 'system'] },
    // Campaign huỷ: bài chưa đăng bị huỷ, kể cả bài đang lỗi (mục 4.1).
    { from: 'failed', to: 'cancelled', by: ['user', 'system'] },
  ],
});
