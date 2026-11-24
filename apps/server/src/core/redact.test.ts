import { describe, expect, it } from 'vitest';
import { redact } from './redact.ts';

describe('redact (TK3 mục 8)', () => {
  it('che khoá bí mật ở mọi tầng', () => {
    expect(redact({ accessToken: 'a', nested: [{ password: 'p', ok: 1 }], Authorization: 'x', apiKey: 'k', cookie: 'c', clientSecret: 's' })).toEqual({
      accessToken: '[đã che]',
      nested: [{ password: '[đã che]', ok: 1 }],
      Authorization: '[đã che]',
      apiKey: '[đã che]',
      cookie: '[đã che]',
      clientSecret: '[đã che]',
    });
  });

  it('giữ nguyên giá trị thường', () => {
    expect(redact('chuỗi')).toBe('chuỗi');
    expect(redact(null)).toBe(null);
    expect(redact({ title: 'Trà sữa', count: 2 })).toEqual({ title: 'Trà sữa', count: 2 });
  });
});
