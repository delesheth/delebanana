// Trạng thái Agent suy ra từ dữ liệu thật (TK2 mục 5): dựng AgentFacts từ DB, gọi deriveAgentState của packages/domain,
// và chỉ phát `agent.state_changed` khi khác trạng thái đã phát gần nhất (`agents.lastState`).

import { deriveAgentState, type AgentFacts, type AgentRole, type RunPurpose, type TaskKind } from '@delebanana/domain';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { agents, approvals, cliRuns, conversations, meetings, messages, tasks } from '../db/schema.ts';
import { isProviderBlocked } from '../agents/usage.ts';
import type { DbLike, UnitOfWork } from './unitOfWork.ts';

export function agentFacts(tx: DbLike, agentId: string, now = Date.now()): AgentFacts {
  const agent = tx.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) throw new Error(`agent ${agentId} không tồn tại`);
  const role = agent.roleTemplate as AgentRole;
  const myTasks = tx.select({ status: tasks.status, kind: tasks.kind, failureSeenAt: tasks.failureSeenAt }).from(tasks).where(eq(tasks.assigneeAgentId, agentId)).all();

  const run = tx
    .select({ purpose: cliRuns.purpose, taskKind: tasks.kind })
    .from(cliRuns)
    .leftJoin(tasks, eq(cliRuns.taskId, tasks.id))
    .where(and(eq(cliRuns.agentId, agentId), isNull(cliRuns.endedAt)))
    .get();

  const inMeeting = tx
    .select({ p: meetings.participantAgentIds })
    .from(meetings)
    .where(isNull(meetings.endedAt))
    .all()
    .some((m) => m.p.includes(agentId));

  let awaitingUserReply = false;
  if (role === 'director') {
    const conv = tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.workspaceId, agent.workspaceId), isNull(conversations.agentId)))
      .get();
    // Mỗi luồng chat chiến dịch (tin không gắn chiến dịch là dữ liệu cũ, bỏ qua) có tin mới nhất riêng: có luồng nào kết thúc bằng câu hỏi của Director thì đang chờ.
    const newest = new Map<string | null, { agentId: string | null; kind: string }>();
    if (conv) {
      for (const m of tx.select({ agentId: messages.agentId, kind: messages.kind, campaignId: messages.campaignId }).from(messages).where(and(eq(messages.conversationId, conv.id), isNotNull(messages.campaignId))).orderBy(desc(messages.createdAt)).all()) {
        if (!newest.has(m.campaignId)) newest.set(m.campaignId, m);
      }
    }
    awaitingUserReply = [...newest.values()].some((last) => last.agentId === agentId && last.kind === 'question');
  }

  const pendingApproval = tx
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.requestedByAgentId, agentId), eq(approvals.status, 'pending')))
    .get();

  return {
    role,
    enabled: agent.enabled,
    inMeeting,
    blocked: isProviderBlocked(tx, agent.provider, now),
    activeRun: run ? { purpose: run.purpose as RunPurpose, ...(run.taskKind ? { taskKind: run.taskKind as TaskKind } : {}) } : undefined,
    runningTaskKind: myTasks.find((t) => t.status === 'running')?.kind as TaskKind | undefined,
    hasWaitingTask: myTasks.some((t) => t.status === 'waiting'),
    hasAssignedTask: myTasks.some((t) => t.status === 'assigned'),
    awaitingUserReply,
    hasPendingApproval: pendingApproval !== undefined,
    unseenFailure: myTasks.some((t) => t.status === 'failed' && t.failureSeenAt === null),
  };
}

export function recomputeAgents(u: UnitOfWork, agentIds: string[]): void {
  for (const id of new Set(agentIds)) {
    const agent = u.tx.select({ workspaceId: agents.workspaceId, lastState: agents.lastState }).from(agents).where(eq(agents.id, id)).get();
    if (!agent) continue;
    const state = deriveAgentState(agentFacts(u.tx, id, u.now));
    if (state === agent.lastState) continue;
    // Task hiện tại để UI/3D hiển thị (running > waiting > assigned).
    const current = ['running', 'waiting', 'assigned']
      .map((status) => u.tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assigneeAgentId, id), eq(tasks.status, status))).get())
      .find(Boolean);
    u.tx.update(agents).set({ lastState: state, lastStateAt: u.now }).where(eq(agents.id, id)).run();
    u.emit({ type: 'agent.state_changed', workspaceId: agent.workspaceId, entity: { kind: 'agent', id }, actor: 'system', data: { state, ...(current ? { taskId: current.id } : {}) } });
  }
}

