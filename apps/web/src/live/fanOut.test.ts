import type { DomainEvent, ServerSnapshot } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import type { LiveSink } from './connection.ts';
import { fanOutSink } from './fanOut.ts';

describe('fanOutSink', () => {
  it('chuyển snapshot/sự kiện/kết nối tới cả hai, kết quả lấy từ primary', () => {
    const log: string[] = [];
    const primary: LiveSink = {
      loadSnapshot: () => log.push('p.snap'),
      receive: () => {
        log.push('p.recv');
        return 'unknown_agent';
      },
      needsResync: () => true,
      setConnection: (s) => log.push(`p.conn.${s}`),
    };
    const sink = fanOutSink(primary, { onSnapshot: () => log.push('l.snap'), onEvent: () => log.push('l.event') });
    sink.loadSnapshot({} as ServerSnapshot);
    expect(sink.receive({} as DomainEvent)).toBe('unknown_agent');
    expect(sink.needsResync()).toBe(true);
    sink.setConnection('online');
    expect(log).toEqual(['p.snap', 'l.snap', 'p.recv', 'l.event', 'p.conn.online']);
  });
});
