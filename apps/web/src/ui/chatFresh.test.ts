import { describe, expect, it } from 'vitest';
import { FRESH_MS, freshIds } from './chatFresh.ts';

const NOW = 1_000_000;
const msg = (id: string, role: 'agent' | 'user' | 'system', ago: number) => ({ id, role, createdAt: NOW - ago });

describe('freshIds', () => {
  it('chỉ tin Director mới tạo, chưa hiện trong khung', () => {
    const list = [msg('old', 'agent', FRESH_MS + 1), msg('shown', 'agent', 10), msg('new', 'agent', 10), msg('mine', 'user', 10), msg('sys', 'system', 10)];
    expect([...freshIds(list, new Set(['shown']), NOW)]).toEqual(['new']);
  });
});
