// Luật bước của Campaign (TK1 khung 5 bước, TK2 4.1–4.2, spec phần 3). Backend chạy, không do LLM quyết:
// điểm duyệt và chuyển bước đều ở đây. Gọi trong `runTx`; `progressCampaign` an toàn khi gọi lặp lại.

import { DEFAULT_VIDEO_TOOL_ID, STAGE_ORDER, videoToolById, type Actor, type MessageAttachment, type StageName, type VideoCheck, type VideoProbe } from '@delebanana/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { notifyDirector } from '../agents/usage.ts';
import type { DbLike, UnitOfWork } from '../core/unitOfWork.ts';
import { agents, approvals, artifacts, assets, campaignStages, campaigns, cliRuns, conversations, events, meetings, messages, posts, reviews, tasks, videoVersions } from '../db/schema.ts';
import { newId } from '../ids.ts';
import { ApprovalError, OPEN, advance, roleAgent, stageOf, startStage, type CampaignRow, type StageRow } from './shared.ts';
import { createCaptionTask, progressPublishing } from './publishing.ts';

export { ApprovalError };

export const MVP_STAGES: StageName[] = ['research', 'scripting', 'video', 'publishing'];
const RESEARCH_KINDS = ['research.trend', 'research.competitor', 'research.audience'];
const SCRIPTS_PER_ROUND = 3;
const OPTIONAL_STAGE: StageName = 'video';
const MAX_REFERENCE_CANDIDATES = 10;

export function createCampaign(u: UnitOfWork, workspaceId: string, title: string, actor: Actor = 'user'): string {
  const id = newId();
  u.tx.insert(campaigns).values({ id, workspaceId, title, stages: MVP_STAGES, status: 'briefing', createdAt: u.now, updatedAt: u.now }).run();
  for (const stage of STAGE_ORDER) {
    u.tx.insert(campaignStages).values({ id: newId(), campaignId: id, stage, status: 'pending', createdAt: u.now, updatedAt: u.now }).run();
  }
  u.emit({ type: 'campaign.created', workspaceId, campaignId: id, entity: { kind: 'campaign', id }, actor, data: { title } });
  return id;
}

/**
 * Tin mở đầu của Director cho chiến dịch mới: một câu hỏi gồm đủ các trường brief bắt buộc. Tin mẫu do backend viết (không
 * tốn lượt LLM); Director chỉ chạy khi chủ công ty trả lời. Workspace chưa có Director hoặc hội thoại thì bỏ qua.
 */
export function openBriefing(u: UnitOfWork, campaignId: string): void {
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!c) return;
  const director = roleAgent(u.tx, c.workspaceId, 'director');
  const conv = u.tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.workspaceId, c.workspaceId), isNull(conversations.agentId))).get();
  if (!director || !conv) return;
  const content = [
    `Chào bạn! Mình sẽ phụ trách chiến dịch "${c.title}". Bạn trả lời giúp mình mấy câu sau nhé (gộp trong một tin cũng được):`,
    '1. Mục tiêu: chiến dịch muốn đạt điều gì (tăng nhận diện, ra mắt sản phẩm, tăng doanh số…)?',
    '2. Đối tượng: khách hàng bạn nhắm tới là ai (độ tuổi, giới tính, sở thích, mối quan tâm)?',
    '3. Sản phẩm: bạn quảng bá sản phẩm gì, điểm nổi bật là gì? Có ảnh sản phẩm thì gửi kèm luôn.',
    '4. Nền tảng: đăng lên đâu — TikTok, Facebook hay Instagram?',
  ].join('\n');
  const id = newId();
  u.tx.insert(messages).values({ id, conversationId: conv.id, role: 'agent', agentId: director.id, campaignId: c.id, content, kind: 'question', createdAt: u.now }).run();
  u.emit({ type: 'message.created', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'message', id }, actor: `agent:${director.id}`, data: { conversationId: conv.id, role: 'agent', agentId: director.id } });
  u.touchAgents([director.id]);
}

/**
 * Bàn giao (Director): briefing → active; bước ngoài danh sách bị bỏ qua; bước đầu bắt đầu chạy. Bước `video` (tuỳ chọn,
 * người dùng bật khi duyệt kịch bản) để `pending`; hết chiến dịch mà chưa bật thì chuyển `skipped` (xem `advance`).
 */
export function activateCampaign(u: UnitOfWork, campaignId: string, actor: Actor): void {
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!c) throw new Error(`campaign ${campaignId} không tồn tại`);
  u.transition({ entity: 'campaign', id: c.id, to: 'active', actor, ctx: { brief: c.brief } });
  for (const stage of STAGE_ORDER) if (!c.stages.includes(stage) && stage !== OPTIONAL_STAGE) u.transition({ entity: 'stage', id: stageOf(u.tx, c.id, stage).id, to: 'skipped', actor: 'system' });
  const first = STAGE_ORDER.find((s) => c.stages.includes(s));
  if (first) startStage(u, c, stageOf(u.tx, c.id, first));
}

/** Vòng hiện tại của bước kịch bản: 1 + số lần bước quay lại chạy sau khi người dùng yêu cầu sửa. */
export function currentRound(tx: DbLike, campaignId: string): number {
  const stage = stageOf(tx, campaignId, 'scripting');
  const reruns = tx
    .select({ data: events.data })
    .from(events)
    .where(and(eq(events.type, 'stage.status_changed'), eq(events.entityId, stage.id)))
    .all()
    .filter((e) => e.data.from === 'awaiting_approval' && e.data.to === 'running').length;
  return 1 + reruns;
}

/**
 * Ảnh người dùng gửi cho Director cho chiến dịch này (ảnh sản phẩm), mới nhất trước, đóng băng vào task video: tin gắn
 * `campaignId` của chiến dịch. Chỉ khi chiến dịch không có ảnh nào gắn nó (dữ liệu cũ) mới dùng tin không gắn chiến dịch
 * nào trong khung thời gian chiến dịch. Tin gắn chiến dịch khác bị loại.
 */
function referenceCandidates(u: UnitOfWork, c: CampaignRow): MessageAttachment[] {
  const convIds = u.tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.workspaceId, c.workspaceId), isNull(conversations.agentId))).all().map((x) => x.id);
  if (convIds.length === 0) return [];
  const images = (where: ReturnType<typeof and>) => {
    const rows = u.tx.select({ attachments: messages.attachments }).from(messages).where(and(inArray(messages.conversationId, convIds), eq(messages.role, 'user'), where)).orderBy(desc(messages.createdAt)).all();
    const seen = new Set<string>();
    const out: MessageAttachment[] = [];
    for (const a of rows.flatMap((r) => r.attachments ?? []))
      if (a.mime.startsWith('image/') && !seen.has(a.id) && seen.add(a.id) && out.length < MAX_REFERENCE_CANDIDATES) out.push(a);
    return out;
  };
  const attached = images(eq(messages.campaignId, c.id));
  return attached.length > 0 ? attached : images(and(isNull(messages.campaignId), gte(messages.createdAt, c.createdAt), lte(messages.createdAt, u.now)));
}

function createVideoTasks(u: UnitOfWork, c: CampaignRow, toolId: string, scriptIds: string[]): void {
  const producer = roleAgent(u.tx, c.workspaceId, 'video_producer');
  const candidates = referenceCandidates(u, c);
  for (const scriptArtifactId of scriptIds) {
    const script = u.tx.select({ taskId: artifacts.taskId }).from(artifacts).where(eq(artifacts.id, scriptArtifactId)).get();
    const id = newId();
    const dependsOn = script?.taskId ? [script.taskId] : [];
    u.tx
      .insert(tasks)
      .values({
        id,
        campaignId: c.id,
        stage: 'video',
        kind: 'video.prompt',
        requiredRole: 'video_producer',
        assigneeAgentId: producer?.id,
        input: { title: 'Soạn prompt video', instructions: 'Soạn prompt tạo video từ kịch bản đã chọn.', toolId, scriptArtifactId, referenceCandidates: candidates },
        dependsOn,
        status: 'queued',
        createdAt: u.now,
        updatedAt: u.now,
      })
      .run();
    u.emit({ type: 'task.created', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'task', id }, actor: 'system', data: { kind: 'video.prompt', stage: 'video', requiredRole: 'video_producer', dependsOn } });
    u.touchAgents([producer?.id]);
  }
}

export function progressCampaign(u: UnitOfWork, campaignId: string): void {
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!c || c.status !== 'active' || !c.currentStage) return;
  const stage = stageOf(u.tx, c.id, c.currentStage);
  if (!stage || stage.status !== 'running') return;
  const stageTasks = u.tx.select().from(tasks).where(and(eq(tasks.campaignId, c.id), eq(tasks.stage, stage.stage))).all();
  if (stageTasks.some((t) => OPEN.includes(t.status))) return;

  if (stage.stage === 'research') {
    const researched = stageTasks.filter((t) => RESEARCH_KINDS.includes(t.kind) && t.status === 'done');
    const syntheses = stageTasks.filter((t) => t.kind === 'research.synthesis');
    if (syntheses.some((t) => t.status === 'done')) return advance(u, c, stage);
    // Chỉ tạo một lần: synthesis thất bại không được tự tạo lại (tránh vòng lặp đốt hạn mức) — rơi xuống nhánh báo kẹt.
    if (syntheses.length === 0 && researched.length > 0) {
      const coord = roleAgent(u.tx, c.workspaceId, 'coordinator');
      const id = newId();
      const dependsOn = researched.map((t) => t.id);
      u.tx
        .insert(tasks)
        .values({
          id,
          campaignId: c.id,
          stage: 'research',
          kind: 'research.synthesis',
          requiredRole: 'coordinator',
          assigneeAgentId: coord?.id,
          input: { title: 'Tổng hợp nghiên cứu', instructions: 'Tổng hợp các kết quả nghiên cứu thành nhận định chính và gợi ý hướng nội dung cho bước kịch bản.' },
          dependsOn,
          status: 'queued',
          createdAt: u.now,
          updatedAt: u.now,
        })
        .run();
      u.emit({ type: 'task.created', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'task', id }, actor: 'system', data: { kind: 'research.synthesis', stage: 'research', requiredRole: 'coordinator', dependsOn } });
      u.touchAgents([coord?.id]);
      return;
    }
  }

  if (stage.stage === 'scripting') {
    const since = stage.startedAt ?? 0;
    const done = stageTasks.filter((t) => t.kind === 'script' && t.status === 'done' && t.createdAt >= since).sort((a, b) => a.createdAt - b.createdAt);
    if (done.length >= SCRIPTS_PER_ROUND) {
      const ids = done.slice(0, SCRIPTS_PER_ROUND).map((t) => u.tx.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.taskId, t.id)).orderBy(desc(artifacts.createdAt)).get()!.id);
      const director = roleAgent(u.tx, c.workspaceId, 'director');
      u.transition({ entity: 'stage', id: stage.id, to: 'awaiting_approval', actor: 'system' });
      const id = newId();
      const subject = { kind: 'artifact', ids, round: currentRound(u.tx, c.id) };
      u.tx
        .insert(approvals)
        .values({ id, workspaceId: c.workspaceId, campaignId: c.id, kind: 'choose_script', subject, requestedByAgentId: director?.id, status: 'pending', createdAt: u.now, updatedAt: u.now })
        .run();
      u.emit({ type: 'approval.requested', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'approval', id }, actor: 'system', data: { kind: 'choose_script', subject: { kind: 'artifact', ids } } });
      u.touchAgents([director?.id]);
      notifyDirector(u, c.workspaceId, `3 kịch bản cho "${c.title}" đã sẵn sàng. Hãy chọn một hoặc nhiều kịch bản để làm video.`, c.id);
      return;
    }
  }

  if (stage.stage === 'video') {
    const round = stageTasks.filter((t) => t.kind === 'video.prompt' && t.createdAt >= (stage.startedAt ?? 0));
    const ready = round.filter((t) => t.status === 'done');
    if (ready.length > 0) {
      // Một prompt thất bại không được làm mất các prompt đã xong: vẫn duyệt phần đã xong, báo Director phần thất bại.
      // Dừng ở đây: chờ người dùng làm video ở nơi tạo video rồi tải lên. Mỗi artifact một Approval make_video + phiên bản #1.
      u.transition({ entity: 'stage', id: stage.id, to: 'awaiting_approval', actor: 'system' });
      const director = roleAgent(u.tx, c.workspaceId, 'director');
      for (const t of ready) {
        const art = u.tx.select({ id: artifacts.id }).from(artifacts).where(and(eq(artifacts.taskId, t.id), eq(artifacts.kind, 'video_prompt'))).orderBy(desc(artifacts.createdAt)).get();
        if (!art) continue;
        const id = newId();
        const subject = { kind: 'artifact', ids: [art.id], toolId: t.input.toolId };
        u.tx.insert(approvals).values({ id, workspaceId: c.workspaceId, campaignId: c.id, kind: 'make_video', subject, requestedByAgentId: director?.id, status: 'pending', createdAt: u.now, updatedAt: u.now }).run();
        u.emit({ type: 'approval.requested', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'approval', id }, actor: 'system', data: { kind: 'make_video', subject: { kind: 'artifact', ids: [art.id] } } });
        createVideoVersion(u, { campaignId: c.id, videoId: art.id, makeVideoApprovalId: id, toolId: String(t.input.toolId), number: 1 });
      }
      u.touchAgents([director?.id]);
      const failed = round.length - ready.length;
      notifyDirector(
        u,
        c.workspaceId,
        failed > 0
          ? `Prompt video cho "${c.title}" đã sẵn sàng (${ready.length} prompt), nhưng ${failed} prompt thất bại. Mở mục "Chờ bạn duyệt" để làm video với phần đã xong.`
          : `Prompt video cho "${c.title}" đã sẵn sàng. Mở mục "Chờ bạn duyệt" để làm video.`,
        c.id,
      );
      return;
    }
  }

  if (stage.stage === 'publishing' && progressPublishing(u, c, stage, stageTasks)) return;

  // Không còn việc mở, vòng này đã có task mà bước không tiến được (task thất bại, hoặc thiếu kịch bản): báo một lần.
  // Bước chưa có task nào trong vòng thì để Coordinator lên kế hoạch.
  const roundTasks = stageTasks.filter((t) => t.createdAt >= (stage.startedAt ?? 0));
  if (roundTasks.length > 0 && stage.summary !== 'stuck') {
    u.tx.update(campaignStages).set({ summary: 'stuck', updatedAt: u.now }).where(eq(campaignStages.id, stage.id)).run();
    notifyDirector(u, c.workspaceId, `Bước ${stage.stage} của "${c.title}" có task thất bại và không thể tự tiếp tục. Cần người dùng xem lại.`, c.id);
  }
}

export function decideChooseScript(
  u: UnitOfWork,
  approvalId: string,
  status: 'approved' | 'rejected' | 'changes_requested',
  decision: { chosen?: string[]; note?: string; video?: { toolId?: string } },
): void {
  const a = u.tx.select().from(approvals).where(eq(approvals.id, approvalId)).get();
  if (!a) throw new ApprovalError(404, `Không có yêu cầu duyệt ${approvalId}`);
  if (a.kind !== 'choose_script') throw new ApprovalError(400, 'Không phải yêu cầu chọn kịch bản');
  if (a.status !== 'pending') throw new ApprovalError(409, 'Yêu cầu này đã được quyết định');
  const offered = (a.subject as { ids: string[] }).ids;
  if (status === 'approved') {
    const chosen = decision.chosen ?? [];
    if (chosen.length === 0 || chosen.some((id) => !offered.includes(id))) throw new ApprovalError(400, 'Phải chọn ít nhất một kịch bản trong số được đề xuất');
    const camp = u.tx.select().from(campaigns).where(eq(campaigns.id, a.campaignId!)).get()!;
    if (decision.video !== undefined || camp.stages.includes(OPTIONAL_STAGE)) {
      if (decision.video !== undefined && !videoToolById(String(decision.video?.toolId))) throw new ApprovalError(400, `Nơi tạo video không hợp lệ: ${String(decision.video?.toolId)}`);
      if (stageOf(u.tx, camp.id, OPTIONAL_STAGE).status !== 'pending') throw new ApprovalError(409, 'Chiến dịch này không làm được bước video (đã bỏ qua từ trước)');
    }
  }
  u.tx.update(approvals).set({ decision }).where(eq(approvals.id, a.id)).run();
  u.transition({ entity: 'approval', id: a.id, to: status, actor: 'user', data: { decision } });
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, a.campaignId!)).get()!;
  const stage = stageOf(u.tx, c.id, 'scripting');
  if (status === 'approved') {
    // Chiến dịch có `video` trong stages (mới): video bắt buộc, "Duyệt" không kèm nơi tạo video dùng nơi mặc định (Q-2).
    // Chiến dịch cũ: chỉ nút "Tạo video" mới bật bước video cho riêng chiến dịch đó.
    const toolId = decision.video?.toolId ?? (c.stages.includes(OPTIONAL_STAGE) ? DEFAULT_VIDEO_TOOL_ID : undefined);
    if (!toolId) return advance(u, c, stage);
    if (!c.stages.includes(OPTIONAL_STAGE)) {
      c.stages = [...c.stages, OPTIONAL_STAGE];
      u.tx.update(campaigns).set({ stages: c.stages }).where(eq(campaigns.id, c.id)).run();
    }
    advance(u, c, stage);
    createVideoTasks(u, c, toolId, decision.chosen!);
    return;
  }
  u.transition({ entity: 'stage', id: stage.id, to: 'running', actor: 'system' });
  u.tx.update(campaignStages).set({ startedAt: u.now, summary: decision.note ?? null }).where(eq(campaignStages.id, stage.id)).run();
}

/**
 * Xoá hẳn một Campaign cùng mọi thứ thuộc về nó (bước, task, đánh giá, kết quả, yêu cầu duyệt, cuộc họp, asset, phiên bản video; trả tên tệp video để người gọi xoá sau commit). Tin nhắn
 * của chiến dịch bị xoá theo (không chuyển sang luồng nào khác); nhật ký lượt chạy CLI được giữ, chỉ bỏ liên kết. Từ chối (409) khi đội ngũ đang có lượt chạy cho Campaign này.
 */
export function deleteCampaign(u: UnitOfWork, campaignId: string): string[] {
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!c) throw new ApprovalError(404, 'Không có chiến dịch');
  const running = u.tx.select({ id: cliRuns.id }).from(cliRuns).where(and(eq(cliRuns.campaignId, campaignId), isNull(cliRuns.endedAt))).get();
  if (running) throw new ApprovalError(409, 'Đội ngũ đang làm việc cho chiến dịch này — đợi xong lượt hiện tại rồi xoá');
  const taskIds = u.tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.campaignId, campaignId)).all().map((t) => t.id);
  const requesters = u.tx.select({ id: approvals.requestedByAgentId }).from(approvals).where(eq(approvals.campaignId, campaignId)).all();
  const assignees = u.tx.select({ id: tasks.assigneeAgentId }).from(tasks).where(eq(tasks.campaignId, campaignId)).all();
  u.tx.update(cliRuns).set({ campaignId: null, taskId: null }).where(eq(cliRuns.campaignId, campaignId)).run();
  if (taskIds.length) {
    u.tx.update(cliRuns).set({ taskId: null }).where(inArray(cliRuns.taskId, taskIds)).run();
    u.tx.delete(reviews).where(inArray(reviews.taskId, taskIds)).run();
  }
  u.tx.delete(messages).where(eq(messages.campaignId, campaignId)).run();
  const videoFiles = u.tx.select({ path: videoVersions.path }).from(videoVersions).where(eq(videoVersions.campaignId, campaignId)).all().flatMap((v) => (v.path ? [v.path] : []));
  u.tx.delete(posts).where(eq(posts.campaignId, campaignId)).run();
  u.tx.delete(videoVersions).where(eq(videoVersions.campaignId, campaignId)).run();
  u.tx.delete(approvals).where(eq(approvals.campaignId, campaignId)).run();
  u.tx.delete(artifacts).where(eq(artifacts.campaignId, campaignId)).run();
  u.tx.delete(meetings).where(eq(meetings.campaignId, campaignId)).run();
  u.tx.delete(assets).where(eq(assets.campaignId, campaignId)).run();
  u.tx.delete(tasks).where(eq(tasks.campaignId, campaignId)).run();
  u.tx.delete(campaignStages).where(eq(campaignStages.campaignId, campaignId)).run();
  u.tx.delete(campaigns).where(eq(campaigns.id, campaignId)).run();
  u.emit({ type: 'campaign.deleted', workspaceId: c.workspaceId, campaignId, entity: { kind: 'campaign', id: campaignId }, actor: 'user', data: { title: c.title } });
  u.audit({ workspaceId: c.workspaceId, campaignId, actor: 'user', action: 'user.campaign.delete', target: { kind: 'campaign', id: campaignId }, result: 'allowed', details: { title: c.title } });
  // Trạng thái Agent (vd. chờ duyệt) tính lại khi việc của họ biến mất.
  u.touchAgents([...requesters, ...assignees].map((r) => r.id));
  return videoFiles;
}

/** Campaign đang chạy (để bộ xếp lịch gọi `progressCampaign`). */
export function activeCampaignIds(tx: DbLike): string[] {
  return tx.select({ id: campaigns.id }).from(campaigns).where(inArray(campaigns.status, ['active'])).all().map((r) => r.id);
}

// ---- Video: phiên bản tải lên và duyệt (phiếu C) ----

type VideoVersionRow = typeof videoVersions.$inferSelect;

function createVideoVersion(u: UnitOfWork, v: { campaignId: string; videoId: string; makeVideoApprovalId: string; toolId: string; number: number }): string {
  const id = newId();
  u.tx.insert(videoVersions).values({ id, ...v, provider: 'manual', status: 'requested', createdAt: u.now, updatedAt: u.now }).run();
  u.transition({ entity: 'video_version', id, to: 'awaiting_upload', actor: 'system' });
  return id;
}

/** Phiên bản mới nhất của một Approval make_video. */
export function latestVideoVersion(tx: DbLike, makeVideoApprovalId: string): VideoVersionRow | undefined {
  return tx.select().from(videoVersions).where(eq(videoVersions.makeVideoApprovalId, makeVideoApprovalId)).orderBy(desc(videoVersions.number)).get();
}

/** Kiểm trước khi nhận tệp (không đổi dữ liệu): Approval make_video còn mở, và phiên bản mới nhất cho phép tải lên (không ready/approved). */
export function checkVideoUploadAllowed(tx: DbLike, makeVideoApprovalId: string): { campaignId: string; videoId: string; toolId: string } {
  const a = tx.select().from(approvals).where(eq(approvals.id, makeVideoApprovalId)).get();
  if (!a) throw new ApprovalError(404, `Không có yêu cầu làm video ${makeVideoApprovalId}`);
  if (a.kind !== 'make_video') throw new ApprovalError(400, 'Không phải yêu cầu làm video');
  if (a.status !== 'pending') throw new ApprovalError(409, 'Yêu cầu làm video này đã đóng');
  const latest = latestVideoVersion(tx, a.id);
  if (latest?.status === 'ready') throw new ApprovalError(409, 'Video đã tải lên đang chờ duyệt — hãy duyệt hoặc từ chối trước khi tải bản mới');
  if (latest?.status === 'approved') throw new ApprovalError(409, 'Video này đã được duyệt');
  const subject = a.subject as { ids: string[]; toolId?: string };
  return { campaignId: a.campaignId!, videoId: subject.ids[0]!, toolId: String(subject.toolId) };
}

export interface VideoUploadResult {
  versionId: string;
  number: number;
  status: 'ready' | 'invalid';
  reasons: string[];
  /** Tên tệp cần có trong thư mục videos (chỉ khi `ready`). */
  filename?: string;
}

const VIDEO_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

/**
 * Ghi kết quả một lần tải lên: dùng phiên bản `awaiting_upload` đang có, hoặc tạo phiên bản mới (number + 1) sau invalid/rejected
 * (máy trạng thái không cho invalid → invalid, rejected là kết thúc). `ready` thì tạo Approval approve_video.
 */
export function recordVideoUpload(u: UnitOfWork, makeVideoApprovalId: string, file: { mime: string; sizeBytes: number; probe: VideoProbe; check: VideoCheck }): VideoUploadResult {
  const target = checkVideoUploadAllowed(u.tx, makeVideoApprovalId);
  const latest = latestVideoVersion(u.tx, makeVideoApprovalId);
  const awaiting = latest?.status === 'awaiting_upload' ? latest : undefined;
  const number = awaiting?.number ?? (latest?.number ?? 0) + 1;
  const versionId = awaiting?.id ?? createVideoVersion(u, { ...target, makeVideoApprovalId, number });
  const ready = file.check.status === 'ready';
  const filename = `${versionId}.${VIDEO_EXT[file.mime] ?? 'mp4'}`;
  u.tx
    .update(videoVersions)
    .set({ mime: file.mime, sizeBytes: file.sizeBytes, metadata: { ...file.probe }, invalidReasons: ready ? null : file.check.reasons, path: ready ? filename : null })
    .where(eq(videoVersions.id, versionId))
    .run();
  u.transition({ entity: 'video_version', id: versionId, to: file.check.status, actor: 'system' });
  if (ready) {
    const c = u.tx.select().from(campaigns).where(eq(campaigns.id, target.campaignId)).get()!;
    const director = roleAgent(u.tx, c.workspaceId, 'director');
    const id = newId();
    const subject = { kind: 'video_version', ids: [versionId], makeVideoApprovalId };
    u.tx.insert(approvals).values({ id, workspaceId: c.workspaceId, campaignId: c.id, kind: 'approve_video', subject, requestedByAgentId: director?.id, status: 'pending', createdAt: u.now, updatedAt: u.now }).run();
    u.emit({ type: 'approval.requested', workspaceId: c.workspaceId, campaignId: c.id, entity: { kind: 'approval', id }, actor: 'system', data: { kind: 'approve_video', subject: { kind: 'video_version', ids: [versionId] } } });
    u.touchAgents([director?.id]);
    notifyDirector(u, c.workspaceId, `Video cho "${c.title}" đã tải lên và hợp lệ. Mở mục "Chờ bạn duyệt" để xem và duyệt.`, c.id);
  }
  return { versionId, number, status: file.check.status, reasons: file.check.reasons, ...(ready ? { filename } : {}) };
}

/**
 * Duyệt/từ chối video. Duyệt: phiên bản `approved`, make_video tương ứng đóng, các make_video/approve_video còn mở của chiến dịch
 * hết hạn (mỗi chiến dịch chỉ cần một video, Q-1) rồi bước video xong. Từ chối: phiên bản `rejected`, giữ prompt và make_video mở
 * để tải bản mới; không tạo task Agent.
 */
export function decideApproveVideo(u: UnitOfWork, approvalId: string, status: 'approved' | 'rejected' | 'changes_requested', decision: Record<string, unknown>): void {
  const a = u.tx.select().from(approvals).where(eq(approvals.id, approvalId)).get();
  if (!a) throw new ApprovalError(404, `Không có yêu cầu duyệt ${approvalId}`);
  if (a.kind !== 'approve_video') throw new ApprovalError(400, 'Không phải yêu cầu duyệt video');
  if (a.status !== 'pending') throw new ApprovalError(409, 'Yêu cầu này đã được quyết định');
  if (status === 'changes_requested') throw new ApprovalError(400, 'Video chỉ có Duyệt hoặc Từ chối (tải bản mới sau khi từ chối)');
  const subject = a.subject as { ids: string[]; makeVideoApprovalId: string };
  const versionId = subject.ids[0]!;
  u.tx.update(approvals).set({ decision }).where(eq(approvals.id, a.id)).run();
  u.transition({ entity: 'approval', id: a.id, to: status, actor: 'user', data: { decision } });
  u.transition({ entity: 'video_version', id: versionId, to: status, actor: 'system' });
  if (status === 'rejected') return;

  u.transition({ entity: 'approval', id: subject.makeVideoApprovalId, to: 'approved', actor: 'user', data: { decision: { closedBy: a.id } } });
  const open = u.tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.campaignId, a.campaignId!), eq(approvals.status, 'pending'), inArray(approvals.kind, ['make_video', 'approve_video']), ne(approvals.id, a.id)))
    .orderBy(asc(approvals.createdAt))
    .all();
  for (const o of open) u.transition({ entity: 'approval', id: o.id, to: 'expired', actor: 'system' });
  const c = u.tx.select().from(campaigns).where(eq(campaigns.id, a.campaignId!)).get()!;
  const stage = stageOf(u.tx, c.id, 'video');
  if (stage.status === 'awaiting_approval') advance(u, c, stage);
  // Chiến dịch mới có bước đăng: viết caption từ video vừa duyệt. Chiến dịch cũ (stages không có publishing) đã completed ở trên.
  if (c.stages.includes('publishing') && stageOf(u.tx, c.id, 'publishing').status === 'running') createCaptionTask(u, c);
}
