import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids.ts';
import { openDb } from './client.ts';

const TABLES = [
  'workspaces',
  'agents',
  'campaigns',
  'campaign_stages',
  'assets',
  'tasks',
  'reviews',
  'artifacts',
  'approvals',
  'conversations',
  'messages',
  'meetings',
  'cli_runs',
  'events',
  'audit',
];

describe('openDb', () => {
  it('có index messages_thread (conversation_id, campaign_id, created_at)', () => {
    const db = openDb(':memory:');
    const cols = db.$client.prepare("PRAGMA index_info('messages_thread')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(['conversation_id', 'campaign_id', 'created_at']);
  });

  it('tạo đủ bảng theo TK1', () => {
    const db = openDb(':memory:');
    const rows = db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of TABLES) expect(names, t).toContain(t);
  });

  it('chạy migration hai lần trên cùng tệp không lỗi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dele-db-'));
    try {
      openDb(join(dir, 'db.sqlite')).$client.close();
      expect(() => openDb(join(dir, 'db.sqlite')).$client.close()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('newId', () => {
  it('ULID 26 ký tự, không trùng', () => {
    const a = newId();
    expect(a).toHaveLength(26);
    expect(newId()).not.toBe(a);
  });
});
