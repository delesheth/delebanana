// Dữ liệu khởi tạo lần đầu: một Workspace với đội mặc định 8 Agent theo D-18 (đủ cho văn phòng 3D). Mọi Agent dùng Claude (D-15).

import type { AgentRole } from '@delebanana/domain';
import { agents, conversations, workspaces } from '../db/schema.ts';
import { newId } from '../ids.ts';
import { recomputeAgents } from './agentState.ts';
import { runTx, type Deps } from './unitOfWork.ts';

export const DEFAULT_ROSTER: { name: string; role: AgentRole; title: string }[] = [
  { name: 'Dele', role: 'director', title: 'Director' },
  { name: 'TC', role: 'coordinator', title: 'Coordinator' },
  { name: 'An', role: 'researcher', title: 'Trend Researcher' },
  { name: 'Chi', role: 'analyst', title: 'Performance Analyst' },
  { name: 'Bình', role: 'creative', title: 'Creative' },
  { name: 'Hà', role: 'scriptwriter', title: 'Scriptwriter' },
  { name: 'Dũng', role: 'video_producer', title: 'Video Producer' },
  { name: 'Giang', role: 'publisher', title: 'Publisher' },
];

const MEMORY_BASE = ['memory.read.shared', 'memory.read.own', 'memory.write.own'];

/** Năng lực mặc định theo vai trò (TK3 mục 5). */
export const DEFAULT_PERMISSIONS: Record<AgentRole, string[]> = {
  director: ['web.research', 'campaign.brief.write', 'user.converse', 'metrics.read', ...MEMORY_BASE],
  coordinator: ['task.manage', 'metrics.read', 'memory.write.shared', ...MEMORY_BASE],
  researcher: ['web.research', ...MEMORY_BASE],
  creative: [...MEMORY_BASE],
  scriptwriter: [...MEMORY_BASE],
  video_producer: [...MEMORY_BASE],
  publisher: ['post.propose', ...MEMORY_BASE],
  analyst: ['web.research', 'metrics.read', ...MEMORY_BASE],
};

export function seedIfEmpty(deps: Deps): { workspaceId: string; created: boolean } {
  const existing = deps.db.select({ id: workspaces.id }).from(workspaces).get();
  if (existing) return { workspaceId: existing.id, created: false };
  return runTx(deps, (u) => {
    const workspaceId = newId();
    u.tx.insert(workspaces).values({ id: workspaceId, name: 'Dele Banana', createdAt: u.now, updatedAt: u.now }).run();
    const ids = DEFAULT_ROSTER.map((r) => {
      const id = newId();
      u.tx
        .insert(agents)
        .values({
          id,
          workspaceId,
          roleTemplate: r.role,
          title: r.title,
          name: r.name,
          provider: 'claude',
          model: 'sonnet',
          permissions: DEFAULT_PERMISSIONS[r.role],
          createdAt: u.now,
          updatedAt: u.now,
        })
        .run();
      return id;
    });
    u.tx.insert(conversations).values({ id: newId(), workspaceId, kind: 'director', createdAt: u.now }).run();
    recomputeAgents(u, ids);
    return { workspaceId, created: true };
  });
}
