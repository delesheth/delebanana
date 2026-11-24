import { describe, expect, it } from 'vitest';
import { step, type Mover } from './motion.ts';

describe('step', () => {
  it('đi theo đường gấp khúc và dừng ở đích', () => {
    const m: Mover = { x: 0, z: 0, heading: 0, path: [{ x: 3, z: 0 }, { x: 3, z: 4 }] };
    expect(step(m, 1, 5)).toBe(false);
    expect(m.x).toBeCloseTo(3);
    expect(m.z).toBeCloseTo(2);
    expect(step(m, 1, 5)).toBe(true);
    expect(m).toMatchObject({ x: 3, z: 4, path: [] });
  });

  it('quay mặt theo hướng đi', () => {
    const m: Mover = { x: 0, z: 0, heading: 0, path: [{ x: 1, z: 0 }] };
    step(m, 0.1, 1);
    expect(m.heading).toBeCloseTo(Math.PI / 2);
  });
});
