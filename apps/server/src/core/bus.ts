// EventBus trong tiến trình: nhận sự kiện đã commit và đẩy tới các kết nối SSE (TK2 mục 6.3).

import type { DomainEvent } from '@delebanana/domain';

export class EventBus {
  private readonly listeners = new Set<(e: DomainEvent) => void>();

  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(events: DomainEvent[]): void {
    for (const e of events) for (const fn of this.listeners) fn(e);
  }
}
