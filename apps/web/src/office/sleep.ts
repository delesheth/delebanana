// Hiệu ứng "Zzz" trên đầu Agent rảnh mà vẫn ngồi ở bàn làm việc. Logic thuần để kiểm thử; phần vẽ ở scene/SleepMarkers.tsx.

import type { AnimationKind } from '@delebanana/domain';
import type { Seat } from './plan.ts';

/** Số chữ Z mỗi nhân vật. */
export const Z_COUNT = 3;
/** Chu kỳ một lượt Z nổi lên (giây). */
export const Z_PERIOD = 3.2;

/** Chỉ hiện khi rảnh, đã tới chỗ và chỗ là ghế làm việc ngồi (không phải Lounge, chỗ đứng, ghế họp). */
export function isSnoozing(animation: AnimationKind | 'off', arrived: boolean, seat: Pick<Seat, 'pool' | 'posture' | 'kind'>): boolean {
  return (
    animation === 'idle' &&
    arrived &&
    seat.pool === 'work' &&
    seat.posture === 'sit' &&
    (seat.kind === 'desk' || seat.kind === 'director' || seat.kind === 'coordinator')
  );
}

export interface ZFrame {
  /** Lệch so với điểm trên đầu: ngang (m, theo trục phải của camera) và lên (m). */
  dx: number;
  dy: number;
  /** Cạnh chữ Z (m). */
  size: number;
  /** 0..1. */
  opacity: number;
}

/** Vị trí/kích thước/độ mờ của chữ Z thứ `index` (0..Z_COUNT-1) tại thời điểm `t` (giây); `phase` lệch pha giữa các nhân vật. */
export function zzzFrame(index: number, t: number, phase = 0): ZFrame {
  const stagger = Z_PERIOD / (Z_COUNT + 1);
  const u = (((t + phase - index * stagger) / Z_PERIOD) % 1 + 1) % 1;
  const grow = 0.34 + index * 0.13;
  const fade = u < 0.15 ? u / 0.15 : u > 0.6 ? Math.max(0, (1 - u) / 0.4) : 1;
  return {
    dx: 0.18 + index * 0.1 + Math.sin(u * Math.PI * 2) * 0.07,
    dy: 0.1 + u * 0.9 + index * 0.18,
    size: grow * (0.8 + 0.4 * u),
    opacity: fade,
  };
}
