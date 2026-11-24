import { describe, expect, it } from 'vitest';
import { SERVICE_RADIUS, SERVICE_STATIONS, initialBartender, stepBartender } from './bartender.ts';
import { BAR_CENTER } from './plan.ts';

describe('người pha chế', () => {
  it('pha nước tại chỗ, rồi đi theo vòng trong quầy tới điểm phục vụ khác, luôn giữ khoảng cách tới tâm quầy', () => {
    const s = initialBartender();
    const seen = new Set<number>();
    let walked = 0;
    let rolls = 0;
    const rand = () => (rolls++ * 0.37) % 1;
    for (let i = 0; i < 4000; i++) {
      const p = stepBartender(s, 0.05, rand);
      expect(Math.hypot(p.x - BAR_CENTER.x, p.z - BAR_CENTER.z)).toBeCloseTo(SERVICE_RADIUS, 6);
      if (p.walking) walked++;
      else seen.add(Math.round(s.angle * 1000));
    }
    expect(walked).toBeGreaterThan(100);
    // Ghé nhiều điểm phục vụ khác nhau, đều là điểm trong danh sách.
    expect(seen.size).toBeGreaterThan(3);
    for (const a of seen) expect(SERVICE_STATIONS.some((st) => Math.round(st * 1000) === a)).toBe(true);
  });

  it('đang pha nước thì quay mặt ra phía ghế quầy', () => {
    const s = initialBartender();
    const p = stepBartender(s, 0.01);
    expect(p.walking).toBe(false);
    expect(p.heading).toBeCloseTo(s.angle, 6);
  });
});
