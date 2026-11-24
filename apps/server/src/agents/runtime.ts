// Bộ xếp lịch (TK1 hàng đợi, TK2 4.3, TK3 mục 7): chạy luật bước, rồi giao lượt cho Agent rảnh theo thứ tự
// Director (trả lời chủ công ty) → review → planning → task. Giới hạn: 1 lượt/Agent, 1 lượt/provider, 2 lượt/Workspace;
// provider bị khoá thì không giao. Mọi vòng lặp có chốt chặn để không đốt hạn mức gói thuê bao (D-14).

import { MAX_CLI_RETRIES, STAGE_ORDER, needsReview, type RunPurpose, type StageName, type TaskKind } from '@delebanana/domain';
import { and, asc, desc, eq, gt, inArray, isNull, max } from 'drizzle-orm';
import { join } from 'node:path';
import { activeCampaignIds, currentRound, progressCampaign } from '../campaign/engine.ts';
import { runTx, type Deps, type UnitOfWork } from '../core/unitOfWork.ts';
import { agents, approvals, artifacts, campaignStages, campaigns, cliRuns, conversations, messages, tasks } from '../db/schema.ts';
import { uploadPath } from '../http/uploads.ts';
import { newId } from '../ids.ts';
import type { Gateway, RunBinding } from './gateway.ts';
import type { Harness, HarnessResult, HarnessSpec } from './harness.ts';
import { directorPrompt, planningPrompt, reviewPrompt, systemPrompt, taskPrompt } from './prompts.ts';
import { blockForOverage, blockForQuota, isProviderBlocked, notifyDirector, recordRateLimit, type RateLimitInfo } from './usage.ts';

export interface RuntimeOptions {
  harness: Harness;
  backendUrl: () => string;
  logDir: string;
  /** Thư mục ảnh tải lên (GET /uploads); có thì Director được xem ảnh trong hội thoại. */
  uploadDir?: string;
  clock?: () => number;
}

const PER_PROVIDER = 1;
const PER_WORKSPACE = 2;
const BUSY_TASK = ['assigned', 'running', 'waiting'];
const OPEN_TASK = ['queued', 'assigned', 'running', 'waiting', 'in_review'];
/** Chốt chặn chống đốt hạn mức (T1/C1): số lượt rỗng liên tiếp trước khi ngừng tự chạy. */
const MAX_EMPTY_REVIEWS = 3;
const MAX_EMPTY_PLANNING = 3;
/** Mỗi tin của chủ công ty được Director xử lý tối đa chừng này lượt. */
const MAX_DIRECTOR_TRIES = 2;
const HISTORY = 20;
/** Số ảnh mới nhất trong hội thoại được chép cho Director xem. */
const MAX_DIRECTOR_IMAGES = 6;

type AgentRow = typeof agents.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type CampaignRow = typeof campaigns.$inferSelect;
/** Phạm vi một lượt chạy: luôn có Workspace, có thể có Campaign (lượt chat của Director thì không). */
interface Scope {
  workspaceId: string;
  campaign?: CampaignRow;
}

const keyOf = (ids: string[]) => [...ids].sort().join(',');

export class Runtime {
  private readonly running = new Set<Promise<void>>();
  /** Bộ đếm chốt chặn, trong bộ nhớ (khởi động lại thì thử lại từ đầu). Khoá gồm tập việc cụ thể để việc mới được thử lại. */
  private readonly emptyReviews = new Map<string, { key: string; count: number }>();
  private readonly emptyPlanning = new Map<string, number>();
  private readonly directorTries = new Map<string, number>();

  private readonly deps: Deps;
  private readonly gateway: Gateway;
  private readonly opts: RuntimeOptions;

  constructor(deps: Deps, gateway: Gateway, opts: RuntimeOptions) {
    this.deps = deps;
    this.gateway = gateway;
    this.opts = opts;
  }

  private now() {
    return this.opts.clock?.() ?? Date.now();
  }

  /** Khi khởi động: lượt chạy dở của lần trước không còn tiến trình → đóng và đưa task về hàng đợi. */
  recover(): void {
    runTx(this.deps, (u) => {
      const open = u.tx.select().from(cliRuns).where(isNull(cliRuns.endedAt)).all();
      for (const r of open) u.tx.update(cliRuns).set({ endedAt: u.now, outcome: 'error' }).where(eq(cliRuns.id, r.id)).run();
      for (const t of u.tx.select().from(tasks).where(inArray(tasks.status, ['assigned', 'running'])).all()) {
        if (t.status === 'assigned') u.transition({ entity: 'task', id: t.id, to: 'running', actor: 'system', ctx: { attempt: t.attempt } });
        // Lượt dở dang tính là một lần thất bại: task làm sập server liên tục sẽ dừng ở `failed` thay vì lặp qua các lần khởi động lại.
        const failures = t.cliFailures + 1;
        u.tx.update(tasks).set({ cliFailures: failures }).where(eq(tasks.id, t.id)).run();
        u.transition({ entity: 'task', id: t.id, to: failures > MAX_CLI_RETRIES ? 'failed' : 'queued', actor: 'system', ctx: { attempt: t.attempt } });
      }
      u.touchAgents(open.map((r) => r.agentId));
    });
  }

  /** Chạy luật bước rồi bắt đầu mọi lượt có thể; trả promise của các lượt vừa bắt đầu. */
  tick(): Promise<void>[] {
    const db = this.deps.db;
    for (const id of activeCampaignIds(db)) {
      try {
        runTx(this.deps, (u) => progressCampaign(u, id));
      } catch (err) {
        console.error('Luật bước lỗi:', err);
      }
    }

    const started: Promise<void>[] = [];
    const now = this.now();
    const openRuns = () => db.select().from(cliRuns).where(isNull(cliRuns.endedAt)).all();
    const agentBusy = (id: string) =>
      openRuns().some((r) => r.agentId === id) ||
      !!db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assigneeAgentId, id), inArray(tasks.status, BUSY_TASK))).get();
    const capacity = (agent: AgentRow) => {
      const runs = openRuns();
      const inWorkspace = runs.filter((r) => db.select({ w: agents.workspaceId }).from(agents).where(eq(agents.id, r.agentId)).get()?.w === agent.workspaceId);
      return (
        agent.enabled &&
        !isProviderBlocked(db, agent.provider, now) &&
        runs.filter((r) => r.provider === agent.provider).length < PER_PROVIDER &&
        inWorkspace.length < PER_WORKSPACE &&
        !agentBusy(agent.id)
      );
    };
    const leadOf = (workspaceId: string, role: 'director' | 'coordinator') =>
      db.select().from(agents).where(and(eq(agents.workspaceId, workspaceId), eq(agents.roleTemplate, role), isNull(agents.archivedAt))).get();

    // 1. Director: mỗi chiến dịch có tin của chủ công ty mới hơn lượt Director gần nhất của chiến dịch đó → chạy
    // (tin gửi lúc Director đang chạy không bị bỏ sót). Chiến dịch có tin chờ lâu nhất chạy trước; mỗi lượt chỉ nạp một chiến dịch.
    // Tin không gắn chiến dịch (dữ liệu cũ của luồng "Chung") không bao giờ kích hoạt lượt Director.
    for (const conv of db.select().from(conversations).where(isNull(conversations.agentId)).all()) {
      const director = leadOf(conv.workspaceId, 'director');
      if (!director) continue;
      const newestPerCampaign = db
        .select({ campaignId: messages.campaignId, at: max(messages.createdAt) })
        .from(messages)
        .innerJoin(campaigns, and(eq(campaigns.id, messages.campaignId), eq(campaigns.workspaceId, conv.workspaceId)))
        .where(and(eq(messages.conversationId, conv.id), eq(messages.role, 'user')))
        .groupBy(messages.campaignId)
        .all();
      const waiting: { campaignId: string; id: string; createdAt: number }[] = [];
      for (const row of newestPerCampaign) {
        if (row.campaignId === null || row.at === null) continue;
        const campaignId = row.campaignId;
        const last = db
          .select({ id: messages.id, createdAt: messages.createdAt })
          .from(messages)
          .where(and(eq(messages.conversationId, conv.id), eq(messages.campaignId, campaignId), eq(messages.role, 'user'), eq(messages.createdAt, row.at)))
          .orderBy(desc(messages.id))
          .get();
        if (!last) continue;
        if ((this.directorTries.get(last.id) ?? 0) >= MAX_DIRECTOR_TRIES) continue;
        const lastRun = db.select({ at: cliRuns.startedAt }).from(cliRuns).where(and(eq(cliRuns.agentId, director.id), eq(cliRuns.campaignId, campaignId))).orderBy(desc(cliRuns.startedAt)).get();
        // Chiến dịch chưa có lượt nào hoặc đã có lượt sau tin này: chỉ chạy nếu Director chưa trả lời (vẫn trong giới hạn số lượt).
        const answered =
          !(lastRun && lastRun.at < last.createdAt) &&
          db
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.conversationId, conv.id), eq(messages.role, 'agent'), eq(messages.campaignId, campaignId), gt(messages.createdAt, last.createdAt)))
            .get() !== undefined;
        if (!answered) waiting.push({ campaignId, id: last.id, createdAt: last.createdAt });
      }
      waiting.sort((x, y) => x.createdAt - y.createdAt);
      const next = waiting[0];
      if (next && capacity(director)) started.push(this.track(this.startDirector(director, conv.id, next.campaignId, next.id)));
    }

    const active = db.select().from(campaigns).where(eq(campaigns.status, 'active')).all();

    // 2. Review: Coordinator đánh giá các task đang chờ của từng Campaign.
    for (const c of active) {
      const pending = db.select().from(tasks).where(and(eq(tasks.campaignId, c.id), eq(tasks.status, 'in_review'))).all();
      const seen = this.emptyReviews.get(c.id);
      const key = keyOf(pending.map((t) => t.id));
      if (pending.length === 0 || (seen && seen.key === key && seen.count >= MAX_EMPTY_REVIEWS)) continue;
      const coord = leadOf(c.workspaceId, 'coordinator');
      if (coord && capacity(coord)) started.push(this.track(this.startReview(coord, c, pending)));
    }

    // 3. Planning: bước đang chạy chưa có task nào mở → Coordinator lên kế hoạch.
    for (const c of active) {
      if (!c.currentStage) continue;
      const stage = db.select().from(campaignStages).where(and(eq(campaignStages.campaignId, c.id), eq(campaignStages.stage, c.currentStage))).get();
      if (stage?.status !== 'running' || stage.summary === 'stuck') continue;
      const since = stage.startedAt ?? 0;
      const stageTasks = db.select().from(tasks).where(and(eq(tasks.campaignId, c.id), eq(tasks.stage, stage.stage))).all();
      if (stageTasks.some((t) => OPEN_TASK.includes(t.status))) continue;
      // Đã có việc trong vòng này (đang chờ luật bước xử lý, hoặc kẹt) thì không lên kế hoạch lại.
      if (stageTasks.some((t) => t.createdAt >= since)) continue;
      const planKey = `${c.id}:${stage.stage}:${currentRound(db, c.id)}`;
      if ((this.emptyPlanning.get(planKey) ?? 0) >= MAX_EMPTY_PLANNING) continue;
      const coord = leadOf(c.workspaceId, 'coordinator');
      if (coord && capacity(coord)) started.push(this.track(this.startPlanning(coord, c, stage, planKey)));
    }

    // 4. Task trong hàng đợi.
    const activeIds = active.map((c) => c.id);
    if (activeIds.length === 0) return started;
    const queued = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'queued'), inArray(tasks.campaignId, activeIds)))
      .orderBy(desc(tasks.priority), asc(tasks.createdAt))
      .all();
    for (const t of queued) {
      const depsDone = t.dependsOn.every((d) => db.select({ s: tasks.status }).from(tasks).where(eq(tasks.id, d)).get()?.s === 'done');
      if (!depsDone) continue;
      const c = active.find((x) => x.id === t.campaignId)!;
      const candidates = t.assigneeAgentId
        ? db.select().from(agents).where(eq(agents.id, t.assigneeAgentId)).all()
        : db
            .select()
            .from(agents)
            .where(and(eq(agents.workspaceId, c.workspaceId), eq(agents.roleTemplate, t.requiredRole), isNull(agents.archivedAt)))
            .all();
      const agent = candidates.find(capacity);
      if (agent) started.push(this.track(this.startTask(agent, c, t)));
    }
    return started;
  }

  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  private track(p: Promise<void>): Promise<void> {
    // Lỗi trong một lượt chạy không được làm sập cả server (unhandled rejection).
    const q = p.catch((err) => console.error('Lượt chạy lỗi:', err)).finally(() => this.running.delete(q));
    this.running.add(q);
    return q;
  }

  /** Mở lượt chạy: token Gateway + bản ghi CliRun (trước `await` đầu tiên, để lần `tick` sau thấy Agent đang bận). */
  private open(agent: AgentRow, scope: Scope, purpose: RunPurpose, extra: { taskId?: string; conversationId?: string } = {}, before?: (u: UnitOfWork) => void) {
    const runId = newId();
    const binding = this.gateway.register({ runId, agentId: agent.id, workspaceId: scope.workspaceId, campaignId: scope.campaign?.id, purpose, ...extra });
    runTx(this.deps, (u) => {
      before?.(u);
      u.tx
        .insert(cliRuns)
        .values({
          id: runId,
          agentId: agent.id,
          taskId: extra.taskId,
          campaignId: scope.campaign?.id,
          provider: agent.provider,
          model: agent.model,
          purpose,
          startedAt: u.now,
          logPath: join(this.opts.logDir, `${runId}.jsonl`),
        })
        .run();
      u.emit({
        type: 'cli_run.started',
        workspaceId: scope.workspaceId,
        campaignId: scope.campaign?.id,
        entity: { kind: 'cli_run', id: runId },
        actor: 'system',
        data: { agentId: agent.id, purpose },
      });
      u.touchAgents([agent.id]);
    });
    return { runId, binding };
  }

  private close(u: UnitOfWork, agent: AgentRow, scope: Scope, runId: string, r: HarnessResult, purpose: RunPurpose, outcome = r.outcome) {
    u.tx
      .update(cliRuns)
      .set({ endedAt: u.now, exitCode: r.exitCode, outcome, usage: r.usage ?? null })
      .where(eq(cliRuns.id, runId))
      .run();
    u.emit({
      type: 'cli_run.finished',
      workspaceId: scope.workspaceId,
      campaignId: scope.campaign?.id,
      entity: { kind: 'cli_run', id: runId },
      actor: 'system',
      data: { agentId: agent.id, purpose, outcome: outcome === 'overage' ? 'error' : outcome, ...(r.usage ? { usage: r.usage } : {}) },
    });
    u.touchAgents([agent.id]);
    this.blockOnOutcome(u, agent, scope, r);
  }

  /** Khoá provider khi hết hạn mức hoặc khi CLI báo dùng mức vượt có tính phí — áp cho mọi loại lượt chạy (D-14). */
  private blockOnOutcome(u: UnitOfWork, agent: AgentRow, scope: Scope, r: HarnessResult) {
    if (r.outcome === 'overage') blockForOverage(u, scope.workspaceId, agent.provider);
    else if (r.outcome === 'quota_exhausted') {
      const reset = r.rateLimits.at(-1)?.resetsAt;
      blockForQuota(u, agent.provider, reset ? reset * 1000 : undefined);
    }
  }

  /** Chạy harness; lỗi bất ngờ thành kết quả `error` để lượt chạy vẫn được đóng đúng cách. */
  private async exec(
    agent: AgentRow,
    scope: Scope,
    runId: string,
    binding: RunBinding,
    prompt: string,
    tools: string[],
    files?: HarnessSpec['files'],
  ): Promise<HarnessResult> {
    try {
      return await this.opts.harness(
        {
          runId,
          token: binding.token,
          backendUrl: this.opts.backendUrl(),
          model: agent.model,
          systemPrompt: systemPrompt(agent),
          prompt,
          tools,
          ...(files?.length ? { files } : {}),
          logPath: join(this.opts.logDir, `${runId}.jsonl`),
        },
        (info: RateLimitInfo) => runTx(this.deps, (u) => recordRateLimit(u, scope.workspaceId, agent.provider, info)),
      );
    } catch (err) {
      return { outcome: 'error', exitCode: null, durationMs: 0, denials: 0, rateLimits: [], error: (err as Error).message };
    } finally {
      this.gateway.release(binding.token);
    }
  }

  private latestArtifact(taskId: string) {
    return this.deps.db.select().from(artifacts).where(eq(artifacts.taskId, taskId)).orderBy(desc(artifacts.createdAt)).get();
  }

  private async startDirector(director: AgentRow, conversationId: string, campaignId: string, messageId: string): Promise<void> {
    const db = this.deps.db;
    this.directorTries.set(messageId, (this.directorTries.get(messageId) ?? 0) + 1);
    // Chỉ thấy chiến dịch của luồng chat; briefing → lượt làm rõ brief của đúng chiến dịch đó. Chiến dịch đã bị xoá giữa chừng → không mở lượt.
    const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
    if (!campaign) return;
    const scope: Scope = { workspaceId: director.workspaceId, campaign };
    const purpose: RunPurpose = campaign.status === 'briefing' ? 'briefing' : 'chat';
    const { runId, binding } = this.open(director, scope, purpose, { conversationId });
    const history = db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.campaignId, campaign.id))).orderBy(desc(messages.createdAt)).limit(HISTORY).all().reverse();
    const infoOf = (c: CampaignRow) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      currentStage: c.currentStage,
      brief: c.brief,
      pendingApprovals: db
        .select({ kind: approvals.kind })
        .from(approvals)
        .where(and(eq(approvals.campaignId, c.id), eq(approvals.status, 'pending')))
        .all()
        .map((a) => a.kind),
    });
    // Ảnh mới nhất (tối đa MAX_DIRECTOR_IMAGES) được chép vào thư mục lượt chạy để Director đọc bằng Read.
    const files: NonNullable<HarnessSpec['files']> = [];
    const imageOf = new Map<string, string>();
    const uploadDir = this.opts.uploadDir;
    for (const m of [...history].reverse()) {
      for (const a of m.attachments ?? []) {
        const from = uploadDir ? uploadPath(uploadDir, a) : undefined;
        if (!from || files.length >= MAX_DIRECTOR_IMAGES) continue;
        const name = `anh/${a.id}${from.slice(from.lastIndexOf('.'))}`;
        files.push({ from, name });
        imageOf.set(a.id, name);
      }
    }
    const messagesIn = history.map((m) => ({
      ...m,
      images: (m.attachments ?? []).map((a) => ({ name: a.name, path: imageOf.get(a.id) })),
    }));
    const prompt = directorPrompt({
      messages: messagesIn,
      campaign: {
        ...infoOf(campaign),
        stages: db
          .select({ stage: campaignStages.stage, status: campaignStages.status })
          .from(campaignStages)
          .where(eq(campaignStages.campaignId, campaign.id))
          .all()
          .sort((x, y) => STAGE_ORDER.indexOf(x.stage as StageName) - STAGE_ORDER.indexOf(y.stage as StageName)),
      },
    });
    const tools = [...(director.permissions.includes('web.research') ? ['WebSearch', 'WebFetch'] : []), ...(files.length ? ['Read'] : [])];
    const result = await this.exec(director, scope, runId, binding, prompt, tools, files);
    runTx(this.deps, (u) => this.close(u, director, scope, runId, result, purpose));
  }

  private async startPlanning(coord: AgentRow, c: CampaignRow, stage: typeof campaignStages.$inferSelect, planKey: string): Promise<void> {
    const db = this.deps.db;
    const scope: Scope = { workspaceId: c.workspaceId, campaign: c };
    const { runId, binding } = this.open(coord, scope, 'planning');
    const countTasks = () => db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.campaignId, c.id), eq(tasks.stage, stage.stage))).all().length;
    const before = countTasks();
    const roster = db.select().from(agents).where(and(eq(agents.workspaceId, c.workspaceId), isNull(agents.archivedAt))).all();
    const previous =
      stage.stage === 'scripting'
        ? db
            .select()
            .from(artifacts)
            .where(and(eq(artifacts.campaignId, c.id), eq(artifacts.kind, 'research_synthesis')))
            .orderBy(desc(artifacts.createdAt))
            .limit(1)
            .all()
            .map((a) => ({ title: 'Tổng hợp nghiên cứu', content: a.content }))
        : [];
    const prompt = planningPrompt({
      campaign: c,
      stage: stage.stage,
      round: currentRound(db, c.id),
      note: stage.summary && stage.summary !== 'stuck' ? stage.summary : undefined,
      roster: roster.map((a) => ({ name: a.name, role: a.roleTemplate })),
      previous,
    });
    const result = await this.exec(coord, scope, runId, binding, prompt, []);
    runTx(this.deps, (u) => {
      this.close(u, coord, scope, runId, result, 'planning');
      const empty = countTasks() === before;
      const count = empty ? (this.emptyPlanning.get(planKey) ?? 0) + 1 : 0;
      this.emptyPlanning.set(planKey, count);
      if (count === MAX_EMPTY_PLANNING) {
        notifyDirector(u, c.workspaceId, `Coordinator chạy ${MAX_EMPTY_PLANNING} lượt lên kế hoạch cho bước ${stage.stage} của "${c.title}" mà không tạo được task nào; đã ngừng để không tốn hạn mức.`, c.id);
      }
    });
  }

  private async startTask(agent: AgentRow, c: CampaignRow, t: TaskRow): Promise<void> {
    const scope: Scope = { workspaceId: c.workspaceId, campaign: c };
    const { runId, binding } = this.open(agent, scope, 'task', { taskId: t.id }, (u) => {
      if (!t.assigneeAgentId) u.tx.update(tasks).set({ assigneeAgentId: agent.id }).where(eq(tasks.id, t.id)).run();
      u.transition({ entity: 'task', id: t.id, to: 'assigned', actor: 'system', ctx: { attempt: t.attempt } });
      u.transition({ entity: 'task', id: t.id, to: 'running', actor: 'system', ctx: { attempt: t.attempt } });
    });
    const dependencies = t.dependsOn.flatMap((d) => {
      const dep = this.deps.db.select().from(tasks).where(eq(tasks.id, d)).get();
      const art = this.latestArtifact(d);
      return dep && art ? [{ title: String(dep.input.title ?? dep.kind), content: art.content }] : [];
    });
    const web = agent.permissions.includes('web.research') && t.kind.startsWith('research.') && t.kind !== 'research.synthesis';
    const result = await this.exec(agent, scope, runId, binding, taskPrompt({ task: t, campaign: c, dependencies }), web ? ['WebSearch', 'WebFetch'] : []);
    this.finishTask(agent, scope, t, runId, binding, result);
  }

  private async startReview(coord: AgentRow, c: CampaignRow, pending: TaskRow[]): Promise<void> {
    const scope: Scope = { workspaceId: c.workspaceId, campaign: c };
    const { runId, binding } = this.open(coord, scope, 'review');
    const items = pending.map((t) => ({ id: t.id, title: String(t.input.title ?? t.kind), content: this.latestArtifact(t.id)?.content ?? '(không có kết quả)' }));
    const result = await this.exec(coord, scope, runId, binding, reviewPrompt({ campaign: c, tasks: items }), []);
    runTx(this.deps, (u) => {
      this.close(u, coord, scope, runId, result, 'review');
      const still = u.tx.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.id, pending.map((t) => t.id)), eq(tasks.status, 'in_review'))).all();
      const key = keyOf(pending.map((t) => t.id));
      const prev = this.emptyReviews.get(c.id);
      const empty = still.length === pending.length ? (prev?.key === key ? prev.count : 0) + 1 : 0;
      this.emptyReviews.set(c.id, { key, count: empty });
      if (empty === MAX_EMPTY_REVIEWS) {
        notifyDirector(u, c.workspaceId, `Coordinator chạy ${MAX_EMPTY_REVIEWS} lượt review liên tiếp cho "${c.title}" mà không đánh giá được task nào; đã ngừng tự review để không tốn hạn mức. Cần người dùng xem lại.`, c.id);
      }
    });
  }

  private finishTask(agent: AgentRow, scope: Scope, t: TaskRow, runId: string, binding: RunBinding, r: HarnessResult): void {
    runTx(this.deps, (u) => {
      const fresh = u.tx.select().from(tasks).where(eq(tasks.id, t.id)).get()!;
      const move = (to: string) => u.transition({ entity: 'task', id: t.id, to, actor: 'system', ctx: { attempt: fresh.attempt } });
      // Lượt "ok" mà không nộp cũng là thất bại: task chưa có kết quả.
      const outcome = r.outcome === 'ok' && !binding.submitted ? 'error' : r.outcome;
      this.close(u, agent, scope, runId, r, 'task', outcome);
      if (fresh.status !== 'running') return; // đã bị huỷ hoặc đổi ở nơi khác
      switch (outcome) {
        case 'ok':
          move(needsReview(t.kind as TaskKind) ? 'in_review' : 'done');
          return;
        case 'quota_exhausted':
        case 'overage':
          move('queued');
          return;
        default: {
          const failures = fresh.cliFailures + 1;
          u.tx.update(tasks).set({ cliFailures: failures }).where(eq(tasks.id, t.id)).run();
          move(failures > MAX_CLI_RETRIES ? 'failed' : 'queued');
        }
      }
    });
  }
}
