import { describe, expect, it } from 'vitest';
import { DESK_AHEAD, DESK_SIZE, U_WINGS, type WorkstationStyle } from '../office/plan.ts';
import { workstation } from './Furniture.tsx';

const TOP = 0.88;
const EPS = 1e-6;

describe('bàn chữ U không lòi vật thể dưới mặt bàn', () => {
  for (const style of ['coordinator', 'director'] as WorkstationStyle[]) {
    it(`${style}: mọi phần dưới mặt bàn nằm trong mặt bằng bàn + hai cánh`, () => {
      const { w, d } = DESK_SIZE[style];
      const wing = U_WINGS[style]!;
      const rects = [
        { x0: -w / 2, x1: w / 2, z0: DESK_AHEAD - d / 2, z1: DESK_AHEAD + d / 2 },
        ...[-1, 1].map((sx) => ({ x0: sx * wing.x - wing.hw, x1: sx * wing.x + wing.hw, z0: wing.z - wing.hd, z1: wing.z + wing.hd })),
      ];
      const under = workstation(style, false).filter((p) => p.p[1] + p.s[1] / 2 < TOP - 0.04 && !p.r);
      expect(under.length).toBeGreaterThan(0);
      for (const p of under) {
        const [x0, x1, z0, z1] = [p.p[0] - p.s[0] / 2, p.p[0] + p.s[0] / 2, p.p[2] - p.s[2] / 2, p.p[2] + p.s[2] / 2];
        const ok = rects.some((r) => x0 >= r.x0 - 0.01 && x1 <= r.x1 + 0.01 && z0 >= r.z0 - 0.01 && z1 <= r.z1 + 0.01);
        expect(ok, JSON.stringify(p)).toBe(true);
      }
    });
  }

  it('coordinator: thùng máy trong mặt bàn và không chồng hộc tủ phải', () => {
    const { w, d } = DESK_SIZE.coordinator;
    const parts = workstation('coordinator', false);
    const tower = parts.find((p) => p.color === '#1d1f23' && p.s[1] === 0.4)!;
    expect(tower.p[2] + tower.s[2] / 2).toBeLessThanOrEqual(DESK_AHEAD + d / 2 + EPS);
    const cab = parts.find((p) => p.p[0] === w / 2 - 0.25 && p.s[0] === 0.48)!;
    const gap = Math.min(tower.p[0] + tower.s[0] / 2, Infinity) <= cab.p[0] - cab.s[0] / 2 + EPS;
    expect(gap).toBe(true);
  });
});
