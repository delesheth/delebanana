// Animation trạng thái → clip có sẵn trong Kenney Mini Characters, kèm lớp chỉnh xương nhẹ
// cho động tác mà bộ clip không có (gõ phím, đọc, xem biểu đồ).

import type { AnimationKind } from '@delebanana/domain';

export type ClipName =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'pick-up'
  | 'emote-yes'
  | 'emote-no'
  | 'holding-right'
  | 'holding-both'
  | 'interact-right'
  | 'interact-left';

/** Chỉnh thêm trên xương sau khi clip chạy. */
export type Overlay = 'none' | 'typing' | 'reading' | 'scanning' | 'tilt';

export interface ClipPlan {
  clip: ClipName;
  overlay: Overlay;
  /** Làm mờ nhân vật (offline). */
  dim: boolean;
  /** Dừng clip ở khung đầu (tư thế tĩnh khi tắt chuyển động trang trí). */
  frozen: boolean;
}

/**
 * Khớp clip với chỗ đang ở: trên sofa/ghế thì ngồi kể cả khi rảnh; ở chỗ đứng (bàn đứng, sau máy quay) thì không ngồi.
 */
export function atSeat(p: ClipPlan, posture: 'sit' | 'stand'): ClipPlan {
  if (posture === 'sit' && p.clip === 'idle') return { ...p, clip: 'sit' };
  if (posture === 'stand' && p.clip === 'sit') return { ...p, clip: 'idle' };
  return p;
}

const plan = (clip: ClipName, overlay: Overlay = 'none', dim = false, frozen = false): ClipPlan => ({ clip, overlay, dim, frozen });

/**
 * `decorative = false` dừng idle loop (thở, lắc lư) ở tư thế tĩnh; động tác công việc giữ nguyên
 * vì nó phản ánh trạng thái thật. (Clip `static` của Kenney là tư thế chữ T nên không dùng.)
 */
export function clipFor(anim: AnimationKind | 'walk', decorative: boolean): ClipPlan {
  // Tư thế đứng/ngồi luôn dừng ở khung đầu của clip (không nhún nhảy); cử động chỉ còn ở tay/đầu (lớp chỉnh xương) khi làm
  // việc và ở bước đi. `decorative = false` dừng luôn thao tác tay ở bảng trắng/thiết bị.
  const still = (clip: ClipName, overlay: Overlay = 'none', dim = false) => plan(clip, overlay, dim, true);
  switch (anim) {
    case 'walk':
      return plan('walk');
    case 'off':
      return still('sit', 'none', true);
    case 'idle':
      return still('idle');
    case 'receive':
      return still('holding-both');
    case 'typing':
      return still('sit', 'typing');
    case 'reading':
      return still('sit', 'reading');
    case 'charts':
      return still('sit', 'scanning');
    case 'whiteboard':
      return plan('interact-right', 'none', false, !decorative);
    case 'device':
      return plan('interact-left', 'none', false, !decorative);
    case 'meeting':
      return still('sit', 'scanning');
    case 'talking':
      return still('idle', 'scanning');
    case 'question':
      return still('idle', 'tilt');
    case 'cards':
      return still('holding-both');
    case 'waiting':
      return still('holding-right');
    case 'warning':
      return still('idle', 'tilt');
    case 'error':
      return still('idle', 'tilt');
  }
}

