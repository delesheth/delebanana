// Dọn sự kiện cũ (TK2 mục 6.4): `agent.state_changed` giữ 30 ngày, loại khác 90 ngày.

import { and, eq, lt, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { events } from '../db/schema.ts';

const DAY = 86_400_000;

export function pruneEvents(db: Db, now: number): number {
  return db
    .delete(events)
    .where(
      or(
        and(eq(events.type, 'agent.state_changed'), lt(events.at, now - 30 * DAY)),
        and(ne(events.type, 'agent.state_changed'), lt(events.at, now - 90 * DAY)),
      ),
    )
    .run().changes;
}
