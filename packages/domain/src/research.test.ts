import { describe, expect, it } from 'vitest';
import { validateSources } from './research.ts';

describe('validateSources (D-4: mỗi phát hiện có nguồn và độ tin cậy)', () => {
  it('nhận nguồn hợp lệ', () => {
    expect(validateSources([{ url: 'https://vietcetera.com/a', claim: 'Gen Z tiết kiệm', confidence: 'medium' }])).toEqual([]);
  });

  it('từ chối nguồn không phải URL http(s)', () => {
    const errors = validateSources([
      { url: 'T1 (An) - tóm tắt xu hướng', claim: 'x', confidence: 'low' },
      { url: 'ftp://a.b/c', claim: 'x', confidence: 'low' },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('nguồn 1');
  });

  it('từ chối claim rỗng hoặc độ tin cậy lạ', () => {
    expect(validateSources([{ url: 'https://a.vn', claim: '  ', confidence: 'high' }])).toHaveLength(1);
    expect(validateSources([{ url: 'https://a.vn', claim: 'x', confidence: 'chắc chắn' as never }])).toHaveLength(1);
  });
});
