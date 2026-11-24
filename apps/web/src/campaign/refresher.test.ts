import { describe, expect, it } from 'vitest';
import { createRefresher } from './refresher.ts';

describe('createRefresher', () => {
  it('5 lần kích hoạt liên tiếp chỉ chạy tối đa 2 lần', async () => {
    const gates: (() => void)[] = [];
    let runs = 0;
    const r = createRefresher(() => {
      runs++;
      return new Promise<void>((res) => gates.push(res));
    });
    for (let i = 0; i < 5; i++) r.trigger();
    expect(runs).toBe(1);
    gates[0]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    gates[1]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    r.trigger();
    expect(runs).toBe(3);
  });

  it('lỗi của lượt chạy không chặn lượt sau', async () => {
    let runs = 0;
    const r = createRefresher(async () => {
      runs++;
      throw new Error('x');
    });
    r.trigger();
    await new Promise((res) => setTimeout(res, 0));
    r.trigger();
    expect(runs).toBe(2);
  });
});
