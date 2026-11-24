import type { DomainEvent } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client.ts';
import { agents, events } from '../db/schema.ts';
import { T0 } from '../test/fixtures.ts';
import { EventBus } from './bus.ts';
import { pruneEvents } from './prune.ts';
import { DEFAULT_ROSTER, seedIfEmpty } from './seed.ts';
import { snapshot } from './snapshot.ts';

const DAY = 86_400_000;

function setup() {
  const db = openDb(':memory:');
  const bus = new EventBus();
  const got: DomainEvent[] = [];
  bus.subscribe((e) => got.push(e));
  return { db, got, deps: { db, bus, clock: () => T0 } };
}

describe('seedIfEmpty', () => {
  it('lần đầu tạo Workspace và đội 8 Agent (D-18), đúng 1 Director và 1 Coordinator', () => {
    const { db, got, deps } = setup();
    expect(seedIfEmpty(deps).created).toBe(true);
    const rows = db.select().from(agents).all();
    expect(rows.map((a) => a.name)).toEqual(DEFAULT_ROSTER.map((r) => r.name));
    expect(rows.filter((a) => a.roleTemplate === 'director')).toHaveLength(1);
    expect(rows.filter((a) => a.roleTemplate === 'coordinator')).toHaveLength(1);
    expect(rows.map((a) => a.roleTemplate)).toEqual(['director', 'coordinator', 'researcher', 'analyst', 'creative', 'scriptwriter', 'video_producer', 'publisher']);
    expect(rows.every((a) => a.provider === 'claude')).toBe(true);
    expect(got.filter((e) => e.type === 'agent.state_changed').map((e) => (e.data as { state: string }).state)).toEqual(Array(DEFAULT_ROSTER.length).fill('idle'));
  });

  it('lần sau không tạo thêm', () => {
    const { db, deps } = setup();
    seedIfEmpty(deps);
    expect(seedIfEmpty(deps).created).toBe(false);
    expect(db.select().from(agents).all()).toHaveLength(DEFAULT_ROSTER.length);
  });
});

describe('snapshot', () => {
  it('trả seq lớn nhất, trạng thái và danh sách Agent', () => {
    const { db, deps } = setup();
    seedIfEmpty(deps);
    const s = snapshot(db);
    const maxSeq = Math.max(...db.select().from(events).all().map((e) => e.seq));
    expect(s.seq).toBe(maxSeq);
    expect(Object.values(s.agents).map((a) => a.state)).toEqual(Array(DEFAULT_ROSTER.length).fill('idle'));
    expect(s.roster).toHaveLength(DEFAULT_ROSTER.length);
    expect(s.workspaces).toHaveLength(1);
  });

  it('mọi sự kiện đã bị dọn → seq vẫn là số cuối, không về 0', () => {
    const { db, deps } = setup();
    seedIfEmpty(deps);
    const last = Math.max(...db.select().from(events).all().map((e) => e.seq));
    db.delete(events).run();
    expect(snapshot(db).seq).toBe(last);
  });

  it('DB rỗng → seq 0', () => {
    expect(snapshot(openDb(':memory:')).seq).toBe(0);
  });
});

describe('pruneEvents', () => {
  it('xoá agent.state_changed quá 30 ngày và loại khác quá 90 ngày', () => {
    const db = openDb(':memory:');
    const now = T0 + 200 * DAY;
    const row = (type: string, ageDays: number) => ({
      at: now - ageDays * DAY,
      type,
      workspaceId: 'W',
      entityKind: 'x',
      entityId: 'y',
      actor: 'system',
      data: {},
    });
    db.insert(events).values([row('agent.state_changed', 31), row('task.status_changed', 31), row('task.status_changed', 91)]).run();
    expect(pruneEvents(db, now)).toBe(2);
    expect(db.select().from(events).all().map((e) => e.type)).toEqual(['task.status_changed']);
  });
});
