// Ghép một kênh SSE cho nhiều bên nhận: văn phòng 3D (`primary`, quyết định resync) và store Campaign/chat.

import type { DomainEvent, ServerSnapshot } from '@delebanana/domain';
import type { LiveSink } from './connection.ts';

/** Phần của store Campaign/chat mà kênh live cần. */
export interface LiveListener {
  onSnapshot(): void;
  onEvent(e: DomainEvent): void;
}

export function fanOutSink(primary: LiveSink, ...listeners: LiveListener[]): LiveSink {
  return {
    loadSnapshot(snap: ServerSnapshot) {
      primary.loadSnapshot(snap);
      for (const l of listeners) l.onSnapshot();
    },
    receive(e) {
      const result = primary.receive(e);
      for (const l of listeners) l.onEvent(e);
      return result;
    },
    needsResync: () => primary.needsResync(),
    setConnection: (status) => primary.setConnection(status),
  };
}
