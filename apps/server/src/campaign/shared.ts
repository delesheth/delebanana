// Phần dùng chung của luật bước (engine) và bước đăng (publishing): lỗi quyết định, truy vấn bước, chuyển bước.

import { STAGE_ORDER, type StageName } from '@delebanana/domain';
import { and, eq } from 'drizzle-orm';
import type { DbLike, UnitOfWork } from '../core/unitOfWork.ts';
import { agents, campaignStages, campaigns } from '../db/schema.ts';

export const OPEN = ['queued', 'assigned', 'running', 'waiting', 'in_review'];

export class ApprovalError extends Error {
  readonly code: 400 | 404 | 409;
  constructor(code: 400 | 404 | 409, message: string) {
    super(message);
    this.code = code;
  }
}

export type StageRow = typeof campaignStages.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;

export function stageOf(tx: DbLike, campaignId: string, stage: string): StageRow {
  // Campaign tạo bằng createCampaign luôn có đủ 5 bước; trả undefined chỉ khi dữ liệu không theo luật đó.
  return tx.select().from(campaignStages).where(and(eq(campaignStages.campaignId, campaignId), eq(campaignStages.stage, stage))).get()!;
}

export function startStage(u: UnitOfWork, c: CampaignRow, s: StageRow) {
  u.transition({ entity: 'stage', id: s.id, to: 'running', actor: 'system' });
  u.tx.update(campaignStages).set({ startedAt: u.now }).where(eq(campaignStages.id, s.id)).run();
  u.tx.update(campaigns).set({ currentStage: s.stage, updatedAt: u.now }).where(eq(campaigns.id, c.id)).run();
}

export function roleAgent(tx: DbLike, workspaceId: string, role: string) {
  return tx.select().from(agents).where(and(eq(agents.workspaceId, workspaceId), eq(agents.roleTemplate, role))).get();
}

export function advance(u: UnitOfWork, c: CampaignRow, from: StageRow) {
  u.transition({ entity: 'stage', id: from.id, to: 'done', actor: 'system' });
  u.tx.update(campaignStages).set({ endedAt: u.now }).where(eq(campaignStages.id, from.id)).run();
  const next = STAGE_ORDER.slice(STAGE_ORDER.indexOf(from.stage as StageName) + 1).find((s) => c.stages.includes(s));
  if (next) startStage(u, c, stageOf(u.tx, c.id, next));
  else {
    // Bước tuỳ chọn người dùng không bật: chốt `skipped` để kết quả cuối giống chiến dịch không có bước đó.
    for (const stage of STAGE_ORDER) {
      const row = stageOf(u.tx, c.id, stage);
      if (row.status === 'pending') u.transition({ entity: 'stage', id: row.id, to: 'skipped', actor: 'system' });
    }
    u.transition({ entity: 'campaign', id: c.id, to: 'completed', actor: 'system' });
  }
}

