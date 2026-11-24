// Ảnh chụp trạng thái cho client khi kết nối hoặc đồng bộ lại (TK2 mục 6.3).

import type { AgentRole, AgentState, ServerSnapshot } from '@delebanana/domain';
import { isNull, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { DbLike } from './unitOfWork.ts';
import { agents, events, workspaces } from '../db/schema.ts';

/**
 * Số thứ tự sự kiện cuối cùng đã cấp. Lấy từ `sqlite_sequence` (AUTOINCREMENT) để không tụt về 0 khi mọi sự kiện
 * đã bị dọn — nếu không, client đang giữ `lastSeq` lớn hơn sẽ bỏ qua snapshot và kẹt.
 */
export function lastSeq(db: DbLike): number {
  const fromSequence = db.get<{ seq: number } | undefined>(sql`SELECT seq FROM sqlite_sequence WHERE name = 'events'`)?.seq;
  const fromTable = db.select({ seq: max(events.seq) }).from(events).get()?.seq;
  return Math.max(fromSequence ?? 0, fromTable ?? 0);
}

export function snapshot(db: Db): ServerSnapshot {
  // Đọc trong một giao dịch để seq và trạng thái khớp nhau.
  return db.transaction((tx) => {
    const seq = lastSeq(tx);
    const rows = tx.select().from(agents).where(isNull(agents.archivedAt)).all();
    return {
      seq,
      agents: Object.fromEntries(rows.map((a) => [a.id, { state: (a.lastState ?? 'offline') as AgentState, since: a.lastStateAt ?? 0 }])),
      workspaces: tx.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(isNull(workspaces.archivedAt)).all(),
      roster: rows.map((a) => ({ id: a.id, workspaceId: a.workspaceId, name: a.name, role: a.roleTemplate as AgentRole, title: a.title })),
    };
  });
}
