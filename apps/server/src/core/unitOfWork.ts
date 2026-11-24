// Đơn vị công việc (TK2 mục 3): mọi đổi trạng thái qua `transition`, ghi bản ghi + sự kiện + nhật ký trong cùng giao dịch
// SQLite; sự kiện chỉ đẩy ra EventBus sau commit. Đường chuyển sai được ghi nhật ký `denied` ở giao dịch riêng.

import {
  approvalMachine,
  campaignMachine,
  checkTransition,
  postMachine,
  stageMachine,
  taskMachine,
  videoVersionMachine,
  type Actor,
  type DomainEvent,
  type EntityKind,
  type EventDataMap,
  type EventType,
  type Machine,
} from '@delebanana/domain';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { approvals, audit, campaignStages, campaigns, events, posts, tasks, videoVersions } from '../db/schema.ts';
import { newId } from '../ids.ts';
import type { EventBus } from './bus.ts';
import { recomputeAgents } from './agentState.ts';
import { redact } from './redact.ts';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbLike = Db | Tx;

export type TransitionEntity = 'campaign' | 'stage' | 'task' | 'approval' | 'video_version' | 'post';

export interface TransitionInput {
  entity: TransitionEntity;
  id: string;
  to: string;
  actor: Actor;
  ctx?: unknown;
  data?: Record<string, unknown>;
}

export interface EmitInput<T extends EventType> {
  type: T;
  workspaceId: string;
  campaignId?: string;
  entity: { kind: EntityKind; id: string };
  actor: Actor;
  data: EventDataMap[T];
}

export interface AuditInput {
  workspaceId: string;
  campaignId?: string;
  actor: Actor;
  action: string;
  target?: { kind: string; id: string };
  result: 'allowed' | 'denied' | 'failed';
  reason?: string;
  cliRunId?: string;
  details?: unknown;
}

export interface UnitOfWork {
  tx: Tx;
  now: number;
  transition(i: TransitionInput): DomainEvent;
  emit<T extends EventType>(i: EmitInput<T>): DomainEvent<T>;
  audit(i: AuditInput): void;
  /** Đánh dấu Agent cần tính lại trạng thái trước khi commit. */
  touchAgents(ids: (string | null | undefined)[]): void;
}

export interface Deps {
  db: Db;
  bus: EventBus;
  clock?: () => number;
}

const MACHINES: Record<TransitionEntity, Machine<string, unknown>> = {
  campaign: campaignMachine as Machine<string, unknown>,
  stage: stageMachine as Machine<string, unknown>,
  task: taskMachine as Machine<string, unknown>,
  approval: approvalMachine as Machine<string, unknown>,
  video_version: videoVersionMachine as Machine<string, unknown>,
  post: postMachine as Machine<string, unknown>,
};

class TransitionDenied extends Error {}

interface Target {
  status: string;
  workspaceId: string;
  campaignId?: string;
  update(status: string, now: number): void;
  event(from: string, to: string, data?: Record<string, unknown>): { type: EventType; data: Record<string, unknown> };
  agents: (string | null)[];
}

function load(tx: Tx, entity: TransitionEntity, id: string): Target | undefined {
  const workspaceOf = (campaignId: string) => tx.select({ w: campaigns.workspaceId }).from(campaigns).where(eq(campaigns.id, campaignId)).get()!.w;
  switch (entity) {
    case 'campaign': {
      const r = tx.select().from(campaigns).where(eq(campaigns.id, id)).get();
      if (!r) return;
      return {
        status: r.status,
        workspaceId: r.workspaceId,
        campaignId: r.id,
        update: (status, now) => tx.update(campaigns).set({ status, updatedAt: now }).where(eq(campaigns.id, id)).run(),
        event: (from, to) => ({ type: 'campaign.status_changed', data: { from, to } }),
        agents: [],
      };
    }
    case 'stage': {
      const r = tx.select().from(campaignStages).where(eq(campaignStages.id, id)).get();
      if (!r) return;
      return {
        status: r.status,
        workspaceId: workspaceOf(r.campaignId),
        campaignId: r.campaignId,
        update: (status, now) => tx.update(campaignStages).set({ status, updatedAt: now }).where(eq(campaignStages.id, id)).run(),
        event: (from, to) => ({ type: 'stage.status_changed', data: { stage: r.stage, from, to } }),
        agents: [],
      };
    }
    case 'task': {
      const r = tx.select().from(tasks).where(eq(tasks.id, id)).get();
      if (!r) return;
      return {
        status: r.status,
        workspaceId: workspaceOf(r.campaignId),
        campaignId: r.campaignId,
        update: (status, now) => tx.update(tasks).set({ status, updatedAt: now }).where(eq(tasks.id, id)).run(),
        event: (from, to) => ({
          type: 'task.status_changed',
          data: { from, to, attempt: r.attempt, ...(r.assigneeAgentId ? { assigneeAgentId: r.assigneeAgentId } : {}) },
        }),
        agents: [r.assigneeAgentId],
      };
    }
    case 'approval': {
      const r = tx.select().from(approvals).where(eq(approvals.id, id)).get();
      if (!r) return;
      return {
        status: r.status,
        workspaceId: r.workspaceId,
        campaignId: r.campaignId ?? undefined,
        update: (status, now) => tx.update(approvals).set({ status, updatedAt: now }).where(eq(approvals.id, id)).run(),
        event: (_from, to, data) => ({ type: 'approval.decided', data: { status: to, ...(data?.decision !== undefined ? { decision: data.decision } : {}) } }),
        agents: [r.requestedByAgentId],
      };
    }
    case 'video_version': {
      const r = tx.select().from(videoVersions).where(eq(videoVersions.id, id)).get();
      if (!r) return;
      return {
        status: r.status,
        workspaceId: workspaceOf(r.campaignId),
        campaignId: r.campaignId,
        update: (status, now) => tx.update(videoVersions).set({ status, updatedAt: now }).where(eq(videoVersions.id, id)).run(),
        event: (from, to) => ({ type: 'video_version.status_changed', data: { from, to, videoId: r.videoId, number: r.number } }),
        agents: [],
      };
    }
    case 'post': {
      const r = tx.select().from(posts).where(eq(posts.id, id)).get();
      if (!r) return;
      return {
        status: r.status,
        workspaceId: workspaceOf(r.campaignId),
        campaignId: r.campaignId,
        update: (status, now) => tx.update(posts).set({ status, updatedAt: now }).where(eq(posts.id, id)).run(),
        event: (from, to) => ({ type: 'post.status_changed', data: { from, to, platform: r.platform } }),
        agents: [],
      };
    }
  }
}

function writeAudit(tx: DbLike, now: number, i: AuditInput) {
  tx.insert(audit)
    .values({
      id: newId(),
      at: now,
      workspaceId: i.workspaceId,
      campaignId: i.campaignId,
      actor: i.actor,
      action: i.action,
      targetKind: i.target?.kind,
      targetId: i.target?.id,
      result: i.result,
      reason: i.reason,
      cliRunId: i.cliRunId,
      details: i.details === undefined ? undefined : redact(i.details),
    })
    .run();
}

function writeDenied(db: Db, now: number, denied: AuditInput[]) {
  if (denied.length > 0) db.transaction((tx) => denied.forEach((d) => writeAudit(tx, now, d)));
}

export function runTx<T>(deps: Deps, fn: (u: UnitOfWork) => T): T {
  const now = deps.clock?.() ?? Date.now();
  const emitted: DomainEvent[] = [];
  const denied: AuditInput[] = [];
  let result: T;
  try {
    result = deps.db.transaction((tx) => {
      const touched = new Set<string>();
      const u: UnitOfWork = {
        tx,
        now,
        emit(i) {
          const row = tx
            .insert(events)
            .values({
              at: now,
              type: i.type,
              workspaceId: i.workspaceId,
              campaignId: i.campaignId,
              entityKind: i.entity.kind,
              entityId: i.entity.id,
              actor: i.actor,
              data: i.data as Record<string, unknown>,
            })
            .returning({ seq: events.seq })
            .get();
          const e = { seq: row.seq, at: now, ...i } as DomainEvent<typeof i.type>;
          emitted.push(e);
          return e;
        },
        audit: (i) => writeAudit(tx, now, i),
        touchAgents(ids) {
          for (const id of ids) if (id) touched.add(id);
        },
        transition(i) {
          const t = load(tx, i.entity, i.id);
          if (!t) throw new Error(`${i.entity} ${i.id} không tồn tại`);
          const check = checkTransition(MACHINES[i.entity], t.status, i.to, i.actor, i.ctx);
          if (!check.ok) {
            denied.push({
              workspaceId: t.workspaceId,
              campaignId: t.campaignId,
              actor: i.actor,
              action: `${i.entity}.transition`,
              target: { kind: i.entity, id: i.id },
              result: 'denied',
              reason: check.reason,
              details: { from: t.status, to: i.to },
            });
            throw new TransitionDenied(check.reason);
          }
          t.update(i.to, now);
          const { type, data } = t.event(t.status, i.to, i.data);
          const e = u.emit({ type, workspaceId: t.workspaceId, campaignId: t.campaignId, entity: { kind: i.entity, id: i.id }, actor: i.actor, data } as EmitInput<EventType>);
          u.audit({
            workspaceId: t.workspaceId,
            campaignId: t.campaignId,
            actor: i.actor,
            action: `${i.entity}.transition`,
            target: { kind: i.entity, id: i.id },
            result: 'allowed',
            details: { from: t.status, to: i.to },
          });
          u.touchAgents(t.agents);
          return e;
        },
      };
      const out = fn(u);
      if (touched.size > 0) recomputeAgents(u, [...touched]);
      return out;
    });
  } catch (err) {
    // Giao dịch đã huỷ; ghi lại các lần bị từ chối để nhật ký vẫn có dấu vết (TK3 mục 8).
    writeDenied(deps.db, now, denied);
    throw err;
  }
  // Người gọi có thể bắt lỗi từ chối rồi vẫn commit: lần từ chối vẫn phải vào nhật ký.
  writeDenied(deps.db, now, denied);
  deps.bus.publish(emitted);
  return result;
}
