// Quy tắc thiết kế (docs/design/05-office-decor.md): đồ đạc trong phòng riêng phải đối xứng qua trục cửa phòng.
// Test này soi gương từng món (vị trí, hướng, loại, màu, kích thước) và vùng cấm đi; thêm đồ lệch một bên là test hỏng.

import { describe, expect, it } from 'vitest';
import { planFor, roomById, type Item, type RoomId } from './plan.ts';

const EPS = 1e-6;
const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const sameAngle = (a: number, b: number) => Math.min(Math.abs(norm(a) - norm(b)), TAU - Math.abs(norm(a) - norm(b))) < 1e-6;

/** Trục đối xứng = đường qua tâm cửa vuông góc với tường có cửa. */
function axisOf(room: RoomId): { along: 'x' | 'z'; at: number } {
  const r = roomById(room);
  const d = r.doors[0]!;
  return d.side === 'n' || d.side === 's' ? { along: 'x', at: d.at } : { along: 'z', at: d.at };
}

function inside(room: RoomId, x: number, z: number) {
  const r = roomById(room).rect;
  return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
}

/** Ảnh gương của một món qua trục: đổi toạ độ, đổi hướng (gương qua x: rot → -rot; gương qua z: rot → π - rot). */
function mirror(it: Item, ax: { along: 'x' | 'z'; at: number }): Item {
  return ax.along === 'x' ? { ...it, x: 2 * ax.at - it.x, rot: -it.rot } : { ...it, z: 2 * ax.at - it.z, rot: Math.PI - it.rot };
}

function same(a: Item, b: Item): boolean {
  const { x: ax, z: az, rot: ar, ...ra } = a;
  const { x: bx, z: bz, rot: br, ...rb } = b;
  // Món tròn/đối xứng tự thân (thảm tròn, chậu, ghế lười, đèn) không phụ thuộc hướng.
  const rotFree = (a.kind === 'rug' && a.round) || ['beanbag', 'floor_lamp', 'flower_vase', 'kenney', 'led_column', 'lamp_post'].includes(a.kind);
  return Math.abs(ax - bx) < EPS && Math.abs(az - bz) < EPS && (rotFree || sameAngle(ar, br)) && JSON.stringify(ra) === JSON.stringify(rb);
}

describe('phòng riêng đối xứng qua trục cửa', () => {
  const plan = planFor(1);
  for (const room of ['research', 'scriptwriting', 'creative'] as const) {
    it(room, () => {
      const ax = axisOf(room);
      const items = plan.items.filter((it) => inside(room, it.x, it.z));
      expect(items.length).toBeGreaterThan(3);
      for (const it of items) {
        const m = mirror(it, ax);
        expect(items.some((o) => same(o, m)), `${it.kind} @ (${it.x}, ${it.z}) thiếu bản đối xứng`).toBe(true);
      }
      const obstacles = plan.obstacles.filter((o) => inside(room, o.x, o.z));
      for (const o of obstacles) {
        const mx = ax.along === 'x' ? 2 * ax.at - o.x : o.x;
        const mz = ax.along === 'z' ? 2 * ax.at - o.z : o.z;
        const hit = obstacles.some((p) => Math.abs(p.x - mx) < EPS && Math.abs(p.z - mz) < EPS && Math.abs(p.hx - o.hx) < EPS && Math.abs(p.hz - o.hz) < EPS);
        expect(hit, `vật cản @ (${o.x}, ${o.z}) thiếu bản đối xứng`).toBe(true);
      }
    });
  }
});
