import { STATE_BEHAVIOR, applyEvent, emptyClientState, statesForRole, type DomainEvent } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import { SeatAllocator, resolveTarget } from '../office/layout.ts';
import { createRoster } from '../office/rosterFixture.ts';

/** Chuỗi sự kiện tất định (LCG): mỗi nhịp một Agent đổi sang trạng thái hợp lệ cho vai trò của mình. */
function* eventStream(roster: ReturnType<typeof createRoster>, seed: number): Generator<DomainEvent<'agent.state_changed'>> {
  let a = seed >>> 0;
  const rng = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let seq = 1; ; seq++) {
    const p = roster[Math.floor(rng() * roster.length)]!;
    const states = statesForRole(p.role);
    const state = states[Math.floor(rng() * states.length)]!;
    yield { seq, at: seq, type: 'agent.state_changed', workspaceId: 'w', entity: { kind: 'agent', id: p.id }, actor: 'system', data: { state } };
  }
}

describe.each([16, 30])('chỗ ngồi cố định, roster %i Agent, 2000 nhịp', (count) => {
  it('không hai Agent chung chỗ; Agent làm việc luôn ở bàn cố định của mình', () => {
    const roster = createRoster(count);
    const alloc = new SeatAllocator();
    for (const p of roster) alloc.register(p.id, p.role);
    const homes = new Map(roster.map((p) => [p.id, alloc.homeOf(p.id)!.seat.id]));
    expect(new Set(homes.values()).size).toBe(count);
    for (const p of roster) alloc.place(p.id, resolveTarget('idle', p.role));

    const events = eventStream(roster, 7);
    let store = emptyClientState;
    const state = (id: string) => store.agents[id]?.state ?? 'idle';
    let atDesk = 0;
    for (let i = 0; i < 2000; i++) {
      const event = events.next().value!;
      store = applyEvent(store, event);
      const mover = roster.find((r) => r.id === event.entity.id)!;
      alloc.place(mover.id, resolveTarget(event.data.state, mover.role));
      expect(new Set(roster.map((p) => alloc.assignmentOf(p.id)!.seat.id)).size, `nhịp ${i}`).toBe(count);
      for (const p of roster) {
        const s = state(p.id);
        const kind = STATE_BEHAVIOR[s].placement.kind;
        if (kind === 'role_home' || kind === 'director_desk' || kind === 'coordinator_desk') {
          expect(alloc.assignmentOf(p.id)!.seat.id, `${p.id}/${s}`).toBe(homes.get(p.id));
          atDesk++;
        }
      }
    }
    expect(atDesk).toBeGreaterThan(0);
    for (const p of roster) expect(alloc.homeOf(p.id)!.seat.id).toBe(homes.get(p.id));
  });
});
