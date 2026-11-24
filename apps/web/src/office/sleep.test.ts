import { describe, expect, it } from 'vitest';
import { isSnoozing, Z_COUNT, Z_PERIOD, zzzFrame } from './sleep.ts';

const desk = { pool: 'work', posture: 'sit', kind: 'desk' } as const;

describe('isSnoozing', () => {
  it('true khi rảnh, đã tới và ngồi ghế làm việc', () => {
    expect(isSnoozing('idle', true, desk)).toBe(true);
    expect(isSnoozing('idle', true, { ...desk, kind: 'director' })).toBe(true);
    expect(isSnoozing('idle', true, { ...desk, kind: 'coordinator' })).toBe(true);
  });

  it('false khi đang đi', () => {
    expect(isSnoozing('idle', false, desk)).toBe(false);
  });

  it('false khi làm việc, họp, offline', () => {
    for (const a of ['typing', 'reading', 'charts', 'receive', 'cards', 'meeting', 'off'] as const) expect(isSnoozing(a, true, desk), a).toBe(false);
  });

  it('false ở chỗ nghỉ Lounge, chỗ đứng và ghế họp', () => {
    expect(isSnoozing('idle', true, { pool: 'rest', posture: 'sit', kind: 'rest' })).toBe(false);
    expect(isSnoozing('idle', true, { pool: 'work', posture: 'stand', kind: 'stand' })).toBe(false);
    expect(isSnoozing('idle', true, { pool: 'work', posture: 'stand', kind: 'desk' })).toBe(false);
    expect(isSnoozing('idle', true, { pool: 'work', posture: 'sit', kind: 'meeting' })).toBe(false);
  });
});

describe('zzzFrame', () => {
  it('chữ sau lớn hơn chữ trước', () => {
    for (const t of [0.5, 1.3, 2.4]) {
      for (let i = 1; i < Z_COUNT; i++) expect(zzzFrame(i, t).size).toBeGreaterThan(zzzFrame(i - 1, t).size);
    }
  });

  it('bay lên và lệch ngang nhẹ trong một chu kỳ', () => {
    const a = zzzFrame(0, 0.1);
    const b = zzzFrame(0, Z_PERIOD * 0.5);
    expect(b.dy).toBeGreaterThan(a.dy);
    for (let t = 0; t < Z_PERIOD; t += 0.1) expect(Math.abs(zzzFrame(0, t).dx)).toBeLessThan(0.4);
    expect(new Set([0.1, 0.8, 1.5].map((t) => zzzFrame(0, t).dx)).size).toBeGreaterThan(1);
  });

  it('mờ về 0 cuối chu kỳ và lặp tuần hoàn', () => {
    expect(zzzFrame(0, Z_PERIOD - 1e-6).opacity).toBeLessThan(0.01);
    const a = zzzFrame(1, 0.7, 0.3);
    const b = zzzFrame(1, 0.7 + Z_PERIOD, 0.3);
    expect(b.dy).toBeCloseTo(a.dy, 6);
    expect(b.opacity).toBeCloseTo(a.opacity, 6);
    for (let t = 0; t < 10; t += 0.05) for (let i = 0; i < Z_COUNT; i++) {
      const o = zzzFrame(i, t).opacity;
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});
