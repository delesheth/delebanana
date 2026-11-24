// Di chuyển nhân vật theo đường gấp khúc. Đường đi là hiệu ứng chuyển tiếp, không phải trạng thái (boundaries.md).

export interface Point {
  x: number;
  z: number;
}

export interface Mover {
  x: number;
  z: number;
  heading: number;
  path: Point[];
}

export const WALK_SPEED = 3.2;

/** Tiến `dt` giây; trả `true` khi đã tới cuối đường. */
export function step(m: Mover, dt: number, speed = WALK_SPEED): boolean {
  let budget = speed * dt;
  while (budget > 0 && m.path.length > 0) {
    const target = m.path[0]!;
    const dx = target.x - m.x;
    const dz = target.z - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) m.heading = Math.atan2(dx, dz);
    if (dist <= budget) {
      m.x = target.x;
      m.z = target.z;
      m.path.shift();
      budget -= dist;
    } else {
      m.x += (dx / dist) * budget;
      m.z += (dz / dist) * budget;
      budget = 0;
    }
  }
  return m.path.length === 0;
}
