import { describe, expect, it } from 'vitest';
import { actorKind, checkTransition, defineMachine, nextStates } from './machine.ts';

type S = 'a' | 'b' | 'c';
const m = defineMachine<S, { ok: boolean }>({
  name: 'mẫu',
  states: ['a', 'b', 'c'],
  terminal: ['c'],
  transitions: [
    { from: 'a', to: 'b', by: ['system'] },
    { from: 'b', to: 'c', by: ['user'], guard: (ctx) => (ctx.ok ? null : 'thiếu X') },
  ],
});

describe('checkTransition', () => {
  it('cho phép đường chuyển đã khai báo với đúng tác nhân', () => {
    expect(checkTransition(m, 'a', 'b', 'system', { ok: true })).toEqual({ ok: true });
  });

  it('từ chối tác nhân không được khai báo', () => {
    const r = checkTransition(m, 'a', 'b', 'user', { ok: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('user');
    expect(checkTransition(m, 'a', 'b', 'agent:x', { ok: true }).ok).toBe(false);
  });

  it('từ chối chuyển về chính nó', () => {
    expect(checkTransition(m, 'a', 'a', 'system', { ok: true }).ok).toBe(false);
  });

  it('trạng thái lạ trả lỗi, không ném ngoại lệ', () => {
    expect(checkTransition(m, 'zzz', 'b', 'system', { ok: true }).ok).toBe(false);
    expect(checkTransition(m, 'a', 'zzz', 'system', { ok: true }).ok).toBe(false);
  });

  it('trả lý do của guard khi không đạt', () => {
    expect(checkTransition(m, 'b', 'c', 'user', { ok: false })).toEqual({ ok: false, reason: 'thiếu X' });
    expect(checkTransition(m, 'b', 'c', 'user', { ok: true })).toEqual({ ok: true });
  });
});

describe('guard theo tác nhân', () => {
  it('guard nhận loại tác nhân', () => {
    const g = defineMachine<S, { n: number }>({
      name: 'thử lại',
      states: ['a', 'b', 'c'],
      terminal: [],
      transitions: [{ from: 'a', to: 'b', by: ['system', 'user'], guard: (ctx, by) => (by === 'system' && ctx.n >= 3 ? 'hết lượt tự thử' : null) }],
    });
    expect(checkTransition(g, 'a', 'b', 'system', { n: 3 })).toEqual({ ok: false, reason: 'hết lượt tự thử' });
    expect(checkTransition(g, 'a', 'b', 'user', { n: 3 })).toEqual({ ok: true });
  });
});

describe('defineMachine', () => {
  it('ném lỗi khi trạng thái kết thúc có đường ra', () => {
    expect(() =>
      defineMachine<S>({ name: 'sai', states: ['a', 'b', 'c'], terminal: ['a'], transitions: [{ from: 'a', to: 'b', by: ['system'] }] }),
    ).toThrow();
  });

  it('ném lỗi khi khai báo chuyển về chính nó', () => {
    expect(() => defineMachine<S>({ name: 'sai', states: ['a', 'b', 'c'], terminal: [], transitions: [{ from: 'a', to: 'a', by: ['system'] }] })).toThrow();
  });

  it('ném lỗi khi đường chuyển dùng trạng thái không khai báo', () => {
    expect(() =>
      defineMachine<string>({ name: 'sai', states: ['a'], terminal: [], transitions: [{ from: 'a', to: 'x', by: ['system'] }] }),
    ).toThrow();
  });
});

describe('tiện ích', () => {
  it('nextStates liệt kê đích hợp lệ', () => {
    expect(nextStates(m, 'a')).toEqual(['b']);
    expect(nextStates(m, 'c')).toEqual([]);
  });

  it('actorKind tách loại tác nhân', () => {
    expect(actorKind('agent:abc')).toBe('agent');
    expect(actorKind('user')).toBe('user');
    expect(actorKind('system')).toBe('system');
  });
});
