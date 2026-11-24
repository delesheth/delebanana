import type { DomainEvent, ServerSnapshot } from '@delebanana/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { office } from '../sim/officeStore.ts';
import { createLiveConnection, type EventSourceLike } from './connection.ts';

class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];
  closed = false;
  private listeners = new Map<string, ((ev: { data?: unknown }) => void)[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, l: (ev: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    if (this.closed) return;
    for (const l of this.listeners.get(type) ?? []) l({ data: typeof data === 'string' || data === undefined ? data : JSON.stringify(data) });
  }
}

const ROSTER: ServerSnapshot['roster'] = [
  { id: 'a-dir', workspaceId: 'w', name: 'Dung', role: 'director', title: 'Director' },
  { id: 'a-res', workspaceId: 'w', name: 'Hoa', role: 'researcher', title: 'Researcher' },
];

function snapshot(seq: number, researcher: 'idle' | 'researching' = 'idle', roster = ROSTER): ServerSnapshot {
  return {
    seq,
    workspaces: [{ id: 'w', name: 'W' }],
    roster,
    agents: Object.fromEntries(roster.map((r) => [r.id, { state: r.id === 'a-res' ? researcher : 'idle', since: 1 }])),
  };
}

function event(seq: number, type: DomainEvent['type'], id: string, data: unknown): DomainEvent {
  return { seq, at: seq, type, workspaceId: 'w', entity: { kind: 'agent', id }, actor: 'system', data } as DomainEvent;
}
const stateChange = (seq: number, id: string, state: string, taskId?: string) => event(seq, 'agent.state_changed', id, { state, taskId });

let snaps: (ServerSnapshot | 'fail' | 'http_error')[];
let fetched: string[];

function start() {
  return createLiveConnection({
    baseUrl: '/api',
    sink: office,
    fetch: async (url) => {
      fetched.push(url);
      const next = snaps.length > 1 ? snaps.shift()! : snaps[0]!;
      if (next === 'fail') throw new Error('mạng lỗi');
      if (next === 'http_error') return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => next };
    },
    openEventSource: (url) => new FakeEventSource(url),
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const lastEs = () => FakeEventSource.all.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  fetched = [];
  office.setConnection('connecting');
});
afterEach(() => vi.useRealTimers());

describe('createLiveConnection', () => {
  it('nạp snapshot rồi mở SSE với after = seq của snapshot; open → online', async () => {
    snaps = [snapshot(5)];
    const conn = start();
    await flush();
    expect(fetched).toEqual(['/api/snapshot']);
    expect(FakeEventSource.all.map((e) => e.url)).toEqual(['/api/events?after=5']);
    expect(office.roster.map((r) => r.name)).toEqual(['Dung', 'Hoa']);
    expect(office.states.lastSeq).toBe(5);
    expect(office.connection).toBe('connecting');
    lastEs().emit('open');
    expect(office.connection).toBe('online');
    conn.stop();
  });

  it('agent.state_changed đổi trạng thái và đích di chuyển của đúng nhân viên', async () => {
    snaps = [snapshot(5)];
    const conn = start();
    await flush();
    lastEs().emit('open');
    const other = office.runtime('a-dir')!;
    const target = office.runtime('a-res')!;
    expect(target.arrived).toBe(true);
    const seatBefore = target.assignment.seat;
    lastEs().emit('agent.state_changed', stateChange(6, 'a-res', 'researching', 't1'));
    expect(office.stateOf('a-res')).toBe('researching');
    expect(office.taskOf('a-res')).toBe('t1');
    expect(target.assignment.seat).not.toBe(seatBefore);
    expect(target.arrived).toBe(false);
    expect(other.arrived).toBe(true);
    expect(office.stateOf('a-dir')).toBe('idle');
    expect(fetched).toHaveLength(1);
    conn.stop();
  });

  it('sự kiện loại khác vẫn tăng seq, không đồng bộ lại', async () => {
    snaps = [snapshot(5)];
    const conn = start();
    await flush();
    lastEs().emit('open');
    lastEs().emit('campaign.created', event(6, 'campaign.created', 'c1', { title: 'x' }));
    lastEs().emit('agent.state_changed', stateChange(7, 'a-res', 'researching'));
    lastEs().emit('ping');
    expect(office.states.lastSeq).toBe(7);
    expect(fetched).toHaveLength(1);
    expect(FakeEventSource.all).toHaveLength(1);
    conn.stop();
  });

  it('resync: lấy lại snapshot và mở SSE từ seq mới', async () => {
    snaps = [snapshot(5), snapshot(20, 'researching')];
    const conn = start();
    await flush();
    const first = lastEs();
    first.emit('open');
    first.emit('resync', { seq: 20 });
    await flush();
    expect(first.closed).toBe(true);
    expect(fetched).toHaveLength(2);
    expect(lastEs().url).toBe('/api/events?after=20');
    expect(office.stateOf('a-res')).toBe('researching');
    conn.stop();
  });

  it('hở seq → đồng bộ lại', async () => {
    snaps = [snapshot(5), snapshot(9)];
    const conn = start();
    await flush();
    lastEs().emit('open');
    lastEs().emit('agent.state_changed', stateChange(8, 'a-res', 'researching'));
    await flush();
    expect(fetched).toHaveLength(2);
    expect(lastEs().url).toBe('/api/events?after=9');
    expect(office.needsResync()).toBe(false);
    conn.stop();
  });

  it('sự kiện cho agent không có trong roster → đồng bộ lại, roster mới được dựng', async () => {
    const bigger = [...ROSTER, { id: 'a-new', workspaceId: 'w', name: 'Mai', role: 'analyst' as const, title: 'Analyst' }];
    snaps = [snapshot(5), snapshot(6, 'idle', bigger)];
    const conn = start();
    await flush();
    lastEs().emit('open');
    lastEs().emit('agent.state_changed', stateChange(6, 'a-new', 'idle'));
    await flush();
    expect(fetched).toHaveLength(2);
    expect(office.roster.map((r) => r.id)).toContain('a-new');
    conn.stop();
  });

  it('sự kiện của Agent đã lưu trữ: đồng bộ lại một lần rồi bỏ qua, không lặp', async () => {
    snaps = [snapshot(5), snapshot(6)];
    const conn = start();
    await flush();
    lastEs().emit('open');
    lastEs().emit('agent.state_changed', stateChange(6, 'a-archived', 'idle'));
    await flush();
    expect(fetched).toHaveLength(2);
    lastEs().emit('agent.state_changed', stateChange(7, 'a-archived', 'working'));
    lastEs().emit('agent.state_changed', stateChange(8, 'a-archived', 'idle'));
    await flush();
    expect(fetched).toHaveLength(2);
    conn.stop();
  });

  it('sự kiện của Agent thuộc Workspace khác: không đồng bộ lại', async () => {
    const other = [...ROSTER, { id: 'a-other', workspaceId: 'w2', name: 'Lan', role: 'analyst' as const, title: 'Analyst' }];
    snaps = [{ ...snapshot(5, 'idle', other), workspaces: [{ id: 'w', name: 'W' }, { id: 'w2', name: 'W2' }] }];
    const conn = start();
    await flush();
    lastEs().emit('open');
    lastEs().emit('agent.state_changed', stateChange(6, 'a-other', 'idle'));
    lastEs().emit('agent.state_changed', stateChange(7, 'a-other', 'idle'));
    await flush();
    expect(fetched).toHaveLength(1);
    expect(office.roster.map((r) => r.id)).not.toContain('a-other');
    conn.stop();
  });

  it('snapshot lỗi (mạng hoặc HTTP): offline, không mở SSE, thử lại giãn cách; thành công → online', async () => {
    snaps = ['fail', 'http_error', snapshot(5)];
    office.setConnection('connecting');
    const conn = start();
    await flush();
    expect(office.connection).toBe('offline');
    expect(FakeEventSource.all).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetched).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetched).toHaveLength(2);
    expect(office.connection).toBe('offline');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetched).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetched).toHaveLength(3);
    expect(FakeEventSource.all).toHaveLength(1);
    lastEs().emit('open');
    expect(office.connection).toBe('online');
    conn.stop();
  });

  it('retryNow khi offline: thử ngay, không chờ hết thời gian lùi', async () => {
    snaps = ['fail', 'fail', snapshot(5)];
    const conn = start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetched).toHaveLength(2);
    conn.retryNow();
    await flush();
    expect(fetched).toHaveLength(3);
    lastEs().emit('open');
    expect(office.connection).toBe('online');
    conn.retryNow(); // đang online: không đồng bộ lại
    await flush();
    expect(fetched).toHaveLength(3);
    conn.stop();
  });

  it('resync khi đang online: đóng SSE cũ, lấy snapshot; server đã tắt → offline ngay', async () => {
    snaps = [snapshot(5), 'fail'];
    const conn = start();
    await flush();
    const first = lastEs();
    first.emit('open');
    expect(office.connection).toBe('online');
    conn.resync();
    await flush();
    expect(first.closed).toBe(true);
    expect(office.connection).toBe('offline');
    conn.stop();
  });

  it('SSE mất kết nối: offline, không sinh sự kiện nào, tự nối lại qua snapshot', async () => {
    snaps = [snapshot(5), snapshot(5)];
    const conn = start();
    await flush();
    const first = lastEs();
    first.emit('open');
    expect(office.connection).toBe('online');
    first.emit('error');
    expect(office.connection).toBe('offline');
    expect(first.closed).toBe(true);
    const seq = office.states.lastSeq;
    await vi.advanceTimersByTimeAsync(500);
    expect(office.states.lastSeq).toBe(seq);
    expect(fetched).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetched).toHaveLength(2);
    expect(FakeEventSource.all).toHaveLength(2);
    lastEs().emit('open');
    expect(office.connection).toBe('online');
    conn.stop();
  });

  it('nối lại cùng roster: Agent đi bộ tới đích mới thay vì dịch chuyển; giãn cách tối đa 10s', async () => {
    snaps = [snapshot(5), 'fail', 'fail', 'fail', 'fail', 'fail', snapshot(30, 'researching')];
    const conn = start();
    await flush();
    const first = lastEs();
    first.emit('open');
    const rt = office.runtime('a-res')!;
    const runtimes = office.runtimes;
    first.emit('error');
    // 1s, 2s, 4s, 8s, 10s (trần) đều lỗi; lần chờ 10s tiếp theo (vẫn trần) thì thành công.
    for (const wait of [1000, 2000, 4000, 8000, 10_000, 10_000]) await vi.advanceTimersByTimeAsync(wait);
    expect(fetched).toHaveLength(7);
    expect(office.runtimes).toBe(runtimes);
    expect(office.runtime('a-res')).toBe(rt);
    expect(office.stateOf('a-res')).toBe('researching');
    expect(rt.arrived).toBe(false);
    conn.stop();
  });

  it('stop() đóng SSE và huỷ thử lại', async () => {
    snaps = ['fail'];
    const conn = start();
    await flush();
    conn.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetched).toHaveLength(1);

    snaps = [snapshot(5)];
    const conn2 = start();
    await flush();
    conn2.stop();
    expect(lastEs().closed).toBe(true);
  });
});
