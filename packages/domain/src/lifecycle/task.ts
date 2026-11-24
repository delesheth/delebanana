// Vòng đời Task — mục 4.3.

import { defineMachine } from '../machine.ts';

export type TaskKind =
  | 'research.trend'
  | 'research.competitor'
  | 'research.audience'
  | 'research.synthesis'
  | 'planning'
  | 'ideation'
  | 'script'
  | 'video.prompt'
  | 'video.template_render'
  | 'caption'
  | 'publish'
  | 'analysis';

export type TaskStatus = 'queued' | 'assigned' | 'running' | 'waiting' | 'in_review' | 'done' | 'failed' | 'cancelled';

/** Lần thử tối đa của một task (1 lần đầu + 2 lần làm lại theo Review). */
export const MAX_ATTEMPTS = 3;
/** Số lần tự chạy lại lượt CLI khi lỗi tạm thời (khác làm lại theo Review). */
export const MAX_CLI_RETRIES = 2;

/** Việc Coordinator tự làm không qua Review. */
export function needsReview(kind: TaskKind): boolean {
  return kind !== 'research.synthesis' && kind !== 'planning';
}

/**
 * Kết quả Review. `pass_with_limits`: chấp nhận và ghi rõ giới hạn khi phần thiếu không thể có được (vd. dữ liệu không lấy
 * được miễn phí, D-17) — tránh vòng làm lại vô ích (rủi ro T1, phát hiện của spike S5).
 */
export type ReviewVerdict = 'pass' | 'pass_with_limits' | 'rework';

/** Trạng thái tiếp theo của task sau Review ở lần thử `attempt`. */
export function reviewOutcome(verdict: ReviewVerdict, attempt: number): TaskStatus {
  if (verdict !== 'rework') return 'done';
  return attempt < MAX_ATTEMPTS ? 'queued' : 'failed';
}

export const taskMachine = defineMachine<TaskStatus, { attempt: number }>({
  name: 'task',
  states: ['queued', 'assigned', 'running', 'waiting', 'in_review', 'done', 'failed', 'cancelled'],
  terminal: ['done', 'failed', 'cancelled'],
  transitions: [
    { from: 'queued', to: 'assigned', by: ['system'] },
    { from: 'assigned', to: 'running', by: ['system'] },
    { from: 'running', to: 'waiting', by: ['system'] },
    { from: 'waiting', to: 'done', by: ['system'] },
    { from: 'waiting', to: 'failed', by: ['system'] },
    { from: 'running', to: 'in_review', by: ['system'] },
    { from: 'running', to: 'done', by: ['system'] },
    { from: 'in_review', to: 'done', by: ['agent'] },
    {
      from: 'in_review',
      to: 'queued',
      by: ['agent'],
      guard: (ctx) => (ctx.attempt < MAX_ATTEMPTS ? null : `đã làm lại tối đa (${MAX_ATTEMPTS} lần thử)`),
    },
    {
      from: 'in_review',
      to: 'failed',
      by: ['system'],
      guard: (ctx) => (ctx.attempt >= MAX_ATTEMPTS ? null : 'còn lượt làm lại'),
    },
    // Hết hạn mức gói thuê bao: xếp lại hàng chờ.
    { from: 'running', to: 'queued', by: ['system'] },
    { from: 'running', to: 'failed', by: ['system'] },
    // Campaign huỷ: mọi task chưa xong bị huỷ (mục 4.1).
    { from: 'queued', to: 'cancelled', by: ['system'] },
    { from: 'assigned', to: 'cancelled', by: ['system'] },
    { from: 'running', to: 'cancelled', by: ['system'] },
    { from: 'waiting', to: 'cancelled', by: ['system'] },
    { from: 'in_review', to: 'cancelled', by: ['system'] },
  ],
});
