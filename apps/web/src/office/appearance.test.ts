import { describe, expect, it } from 'vitest';
import { STAFFING_ORDER } from '@delebanana/domain';
import { DIRECTOR_MODEL, appearanceFor } from './appearance.ts';

describe('appearanceFor', () => {
  it('Giám đốc là nhân vật nam mặc vest (thân gốc của model vest)', () => {
    const director = appearanceFor(0);
    expect(director.model).toBe(DIRECTOR_MODEL);
    expect(director.outfit).toBeUndefined();
  });

  it('nhân viên mặc sơ mi hoặc polo có cổ', () => {
    for (let i = 1; i < 24; i++) expect(['shirt', 'polo']).toContain(appearanceFor(i).outfit?.top);
  });

  it('24 người đầu không ai trùng ai (đầu, áo, màu, dáng)', () => {
    const keys = Array.from({ length: 24 }, (_, i) => JSON.stringify(appearanceFor(i)));
    expect(new Set(keys).size).toBe(24);
  });

  it('trưởng phòng (vị trí 1) là nữ tóc đỏ đô', () => {
    const tc = appearanceFor(1);
    expect(tc.model.startsWith('female-')).toBe(true);
    expect(tc.outfit?.hair).toBe('#6d1a24');
  });

  it('phần lớn là nhân viên nam', () => {
    const male = Array.from({ length: 24 }, (_, i) => appearanceFor(i).model).filter((m) => m.startsWith('male-'));
    expect(male.length).toBeGreaterThanOrEqual(17);
  });

  it('không dùng đầu có mũ liền (male-c mũ cảnh sát, male-g mũ len)', () => {
    const heads = Array.from({ length: 48 }, (_, i) => appearanceFor(i).model);
    expect(heads).not.toContain('male-c');
    expect(heads).not.toContain('male-g');
  });

  it('người có phòng riêng mặc theo cá tính phòng: hiphop, nữ tính hồng', () => {
    const at = (role: (typeof STAFFING_ORDER)[number]) => appearanceFor(STAFFING_ORDER.indexOf(role));
    expect(at('creative').outfit).toMatchObject({ chain: true });
    expect(at('creative').outfit?.hat).toBeUndefined();
    expect(at('scriptwriter').model.startsWith('female-')).toBe(true);
    expect(at('scriptwriter').outfit?.shirt).toBe('#f7b6c8');
  });

  it('ngoài dây chuyền của người hiphop, mọi người mặc đồ công sở không đội mũ', () => {
    const themed = new Set<number>();
    for (let i = 1; i < 24; i++) {
      if (themed.has(i)) continue;
      const o = appearanceFor(i).outfit!;
      expect(!o.hat && !o.bandana && !o.boots, `#${i}`).toBe(true);
    }
  });
});
