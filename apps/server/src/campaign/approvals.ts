// Quyết định Approval của người dùng (TK3 mục 5–6, spec phần 3). Mọi quyết định ghi nhật ký `user.approval.decide`.

import { eq } from 'drizzle-orm';
import type { Gateway } from '../agents/gateway.ts';
import { notifyDirector } from '../agents/usage.ts';
import { runTx, type Deps } from '../core/unitOfWork.ts';
import { agents, approvals } from '../db/schema.ts';
import { ApprovalError, decideApproveVideo, decideChooseScript } from './engine.ts';
import { decideApprovePublish } from './publishing.ts';

const STATUSES = ['approved', 'rejected', 'changes_requested'] as const;
type Decision = (typeof STATUSES)[number];

export function decideApproval(deps: Deps, gateway: Gateway | undefined, id: string, input: { status: string; decision?: Record<string, unknown> }): { ok: true } {
  if (!STATUSES.includes(input.status as Decision)) throw new ApprovalError(400, 'status phải là approved, rejected hoặc changes_requested');
  const status = input.status as Decision;
  const decision = input.decision ?? {};
  const a = deps.db.select().from(approvals).where(eq(approvals.id, id)).get();
  if (!a) throw new ApprovalError(404, `Không có yêu cầu duyệt ${id}`);
  const log = (u: Parameters<Parameters<typeof runTx>[1]>[0], result: 'allowed' | 'failed', reason?: string) =>
    u.audit({ workspaceId: a.workspaceId, campaignId: a.campaignId ?? undefined, actor: 'user', action: 'user.approval.decide', target: { kind: 'approval', id }, result, reason, details: { kind: a.kind, status, decision } });

  if (a.kind === 'choose_script') {
    runTx(deps, (u) => {
      decideChooseScript(u, id, status, decision as { chosen?: string[]; note?: string });
      log(u, 'allowed');
    });
    return { ok: true };
  }

  if (a.kind === 'approve_video') {
    runTx(deps, (u) => {
      decideApproveVideo(u, id, status, decision);
      log(u, 'allowed');
    });
    return { ok: true };
  }

  if (a.kind === 'approve_publish') {
    runTx(deps, (u) => {
      decideApprovePublish(u, id, status, decision);
      log(u, 'allowed');
    });
    return { ok: true };
  }

  // Làm video chỉ đóng khi video được duyệt (hoặc hết hạn cùng chiến dịch), không có quyết định tay.
  if (a.kind === 'make_video') throw new ApprovalError(400, 'Làm video được đóng khi video được duyệt');

  if (a.status !== 'pending') throw new ApprovalError(409, 'Yêu cầu này đã được quyết định');
  const subject = a.subject as { tool?: string; arguments?: Record<string, unknown>; agentId?: string; capability?: string };
  runTx(deps, (u) => {
    u.tx.update(approvals).set({ decision }).where(eq(approvals.id, id)).run();
    u.transition({ entity: 'approval', id, to: status, actor: 'user', data: { decision } });
    if (a.kind === 'out_of_permission' && status === 'approved' && decision.grant === 'permanent' && subject.agentId && subject.capability) {
      const agent = u.tx.select().from(agents).where(eq(agents.id, subject.agentId)).get();
      if (agent && !agent.permissions.includes(subject.capability)) {
        u.tx.update(agents).set({ permissions: [...agent.permissions, subject.capability], updatedAt: u.now }).where(eq(agents.id, agent.id)).run();
        u.emit({ type: 'agent.config_changed', workspaceId: a.workspaceId, entity: { kind: 'agent', id: agent.id }, actor: 'user', data: { fields: ['permissions'] } });
      }
    }
    log(u, 'allowed');
  });

  // Chạy lại lời gọi đã bị chặn, sau khi quyết định đã lưu (TK3 mục 5).
  if (a.kind === 'out_of_permission' && status === 'approved' && gateway && subject.tool && subject.agentId) {
    try {
      gateway.runAs(subject.agentId, a.workspaceId, a.campaignId ?? undefined, subject.tool, subject.arguments ?? {}, decision.grant !== 'permanent');
    } catch (err) {
      runTx(deps, (u) => {
        log(u, 'failed', (err as Error).message);
        notifyDirector(u, a.workspaceId, `Đã duyệt nhưng chạy lại ${subject.tool} không thành công: ${(err as Error).message}`, a.campaignId ?? undefined);
      });
    }
  }
  return { ok: true };
}
