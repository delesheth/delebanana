import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, applyEvent, applySnapshot, emptyClientState, type DomainEvent } from './events.ts';
import type { AgentState } from './states.ts';

function agentEvent(seq: number, id: string, state: AgentState, at = seq): DomainEvent<'agent.state_changed'> {
  return { seq, at, type: 'agent.state_changed', workspaceId: 'w', entity: { kind: 'agent', id }, actor: 'system', data: { state } };
}

describe('applyEvent', () => {
  it('áp sự kiện agent.state_changed theo thứ tự', () => {
    const s = applyEvent(emptyClientState, agentEvent(1, 'a', 'researching', 10));
    expect(s.lastSeq).toBe(1);
    expect(s.agents.a).toEqual({ state: 'researching', since: 10, taskId: undefined });
    expect(s.needsResync).toBe(false);
  });

  it('giữ taskId của sự kiện', () => {
    const e = { ...agentEvent(1, 'a', 'writing'), data: { state: 'writing' as const, taskId: 't1' } };
    expect(applyEvent(emptyClientState, e).agents.a?.taskId).toBe('t1');
  });

  it('bỏ qua sự kiện cũ hoặc trùng', () => {
    const s1 = applyEvent(emptyClientState, agentEvent(2, 'a', 'idle'));
    const s2 = applyEvent(s1, agentEvent(2, 'a', 'error'));
    const s3 = applyEvent(s2, agentEvent(1, 'a', 'error'));
    expect(s3).toBe(s1);
  });

  it('đánh dấu cần đồng bộ lại khi hở số thứ tự', () => {
    const s1 = applyEvent(emptyClientState, agentEvent(1, 'a', 'idle'));
    const s2 = applyEvent(s1, agentEvent(3, 'a', 'writing'));
    expect(s2.needsResync).toBe(true);
    expect(s2.agents.a?.state).toBe('writing');
  });

  it('sự kiện loại khác chỉ tăng lastSeq, không đổi agents', () => {
    const s1 = applyEvent(emptyClientState, agentEvent(1, 'a', 'idle'));
    const e: DomainEvent<'task.status_changed'> = {
      seq: 2,
      at: 2,
      type: 'task.status_changed',
      workspaceId: 'w',
      campaignId: 'c',
      entity: { kind: 'task', id: 't' },
      actor: 'agent:coord',
      data: { from: 'in_review', to: 'done', attempt: 1 },
    };
    const s2 = applyEvent(s1, e);
    expect(s2.lastSeq).toBe(2);
    expect(s2.agents).toBe(s1.agents);
    expect(s2.needsResync).toBe(false);
  });

  it('kiểu data theo loại sự kiện', () => {
    const e: DomainEvent<'post.status_changed'> = {
      seq: 1,
      at: 1,
      type: 'post.status_changed',
      workspaceId: 'w',
      entity: { kind: 'post', id: 'p' },
      actor: 'system',
      data: { from: 'scheduled', to: 'publishing', platform: 'tiktok' },
    };
    expect(applyEvent(emptyClientState, e).lastSeq).toBe(1);
  });
});

describe('sự kiện bộ nhớ (TK4 mục 9)', () => {
  it('memory.created và memory.status_changed chỉ tăng lastSeq', () => {
    const created: DomainEvent<'memory.created'> = {
      seq: 1,
      at: 1,
      type: 'memory.created',
      workspaceId: 'w',
      campaignId: 'c',
      entity: { kind: 'memory', id: 'm' },
      actor: 'agent:coord',
      data: { owner: 'shared', type: 'lesson', status: 'proposed' },
    };
    const changed: DomainEvent<'memory.status_changed'> = {
      seq: 2,
      at: 2,
      type: 'memory.status_changed',
      workspaceId: 'w',
      entity: { kind: 'memory', id: 'm' },
      actor: 'user',
      data: { from: 'proposed', to: 'active' },
    };
    const s = applyEvent(applyEvent(emptyClientState, created), changed);
    expect(s.lastSeq).toBe(2);
    expect(s.agents).toEqual({});
  });
});

describe('applySnapshot', () => {
  it('thay trạng thái và xoá cờ đồng bộ lại', () => {
    const gapped = { lastSeq: 5, agents: {}, needsResync: true };
    const s = applySnapshot(gapped, { seq: 7, agents: { b: { state: 'idle', since: 0 } } });
    expect(s).toEqual({ lastSeq: 7, agents: { b: { state: 'idle', since: 0 } }, needsResync: false });
  });

  it('bỏ qua snapshot cũ hơn sự kiện đã nhận', () => {
    const s1 = applyEvent(emptyClientState, agentEvent(4, 'a', 'idle'));
    expect(applySnapshot(s1, { seq: 3, agents: {} })).toBe(s1);
  });
});

describe('EVENT_TYPES', () => {
  it('liệt kê mỗi loại sự kiện đúng một lần', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    expect(EVENT_TYPES).toContain('agent.state_changed');
    expect(EVENT_TYPES).toContain('cli_run.finished');
    expect(EVENT_TYPES).toHaveLength(21);
  });
});
