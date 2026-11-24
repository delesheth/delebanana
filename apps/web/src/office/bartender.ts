// Người pha chế đi lại bên trong quầy bar tròn: đi theo cung tròn quanh tháp rượu tới một điểm phục vụ ngẫu nhiên, quay
// mặt ra ghế quầy pha nước vài giây rồi đi tiếp. Thuần TS (ngẫu nhiên được tiêm vào) để kiểm thử.

import { BAR_CENTER, BAR_COUNTER_DEPTH, BAR_RADIUS, BAR_TOWER_RADIUS } from './plan.ts';

/** Bán kính lối đi trong quầy: chính giữa chân tháp rượu và mép mặt quầy phía trong. */
export const SERVICE_RADIUS = (BAR_TOWER_RADIUS + BAR_RADIUS - BAR_COUNTER_DEPTH) / 2;
/** Điểm phục vụ (góc quanh tâm quầy, 0 = phía nam/camera), đối xứng qua trục quầy. */
export const SERVICE_STATIONS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
const SPEED = 0.9;
const SERVE_SECONDS: [number, number] = [2.5, 5];

export interface BartenderState {
  /** Góc hiện tại quanh tâm quầy. */
  angle: number;
  target: number;
  /** Còn bao lâu nữa thì đi tiếp (đang pha nước). */
  serving: number;
}

export interface BartenderPose {
  x: number;
  z: number;
  heading: number;
  walking: boolean;
}

const TAU = Math.PI * 2;
/** Hiệu góc ngắn nhất từ a tới b, trong (-π, π]. */
const delta = (a: number, b: number) => {
  const d = (((b - a) % TAU) + TAU) % TAU;
  return d > Math.PI ? d - TAU : d;
};

export function initialBartender(): BartenderState {
  return { angle: 0, target: 0, serving: SERVE_SECONDS[0] };
}

export function stepBartender(s: BartenderState, dt: number, rand: () => number = Math.random): BartenderPose {
  if (s.serving > 0) {
    s.serving -= dt;
    if (s.serving <= 0) {
      // Chọn điểm khác điểm đang đứng.
      const others = SERVICE_STATIONS.filter((a) => Math.abs(delta(a, s.angle)) > 1e-3);
      s.target = others[Math.floor(rand() * others.length) % others.length]!;
    }
    return pose(s.angle, s.angle, false);
  }
  const d = delta(s.angle, s.target);
  const stepAngle = (SPEED * dt) / SERVICE_RADIUS;
  if (Math.abs(d) <= stepAngle) {
    s.angle = s.target;
    s.serving = SERVE_SECONDS[0] + rand() * (SERVE_SECONDS[1] - SERVE_SECONDS[0]);
    return pose(s.angle, s.angle, false);
  }
  s.angle += Math.sign(d) * stepAngle;
  // Đi theo tiếp tuyến của vòng tròn, đúng chiều đang đi.
  return pose(s.angle, s.angle + Math.sign(d) * (Math.PI / 2), true);
}

/** Đứng ở góc `a`; `heading` = hướng mặt (đang pha nước thì quay ra ghế quầy, tức hướng `a`). */
function pose(a: number, heading: number, walking: boolean): BartenderPose {
  return { x: BAR_CENTER.x + Math.sin(a) * SERVICE_RADIUS, z: BAR_CENTER.z + Math.cos(a) * SERVICE_RADIUS, heading, walking };
}
