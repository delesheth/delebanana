// Cổng công cụ MCP (TK3 mục 4–5): cách duy nhất Agent tác động hệ thống. Mỗi lời gọi: xác định lượt chạy qua token →
// kiểm mục đích lượt chạy → kiểm năng lực → kiểm phạm vi và vòng đời → làm → ghi nhật ký (kể cả bị từ chối).

import {
  CAPTION_MAX_LENGTH,
  MAX_ATTEMPTS,
  checkVideoSpec,
  videoToolById,
  withVideoDirective,
  type MessageAttachment,
  reviewOutcome,
  validateSources,
  type AgentRole,
  type ReviewVerdict,
  type RunPurpose,
  type Source,
  type StageName,
  type TaskKind,
} from '@delebanana/domain';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { runTx, type Deps, type UnitOfWork } from '../core/unitOfWork.ts';
import { activateCampaign } from '../campaign/engine.ts';
import { composeCaption } from '../campaign/publishing.ts';
import { notifyDirector } from './usage.ts';
import { agents, approvals, artifacts, campaignStages, campaigns, cliRuns, conversations, messages, reviews, tasks } from '../db/schema.ts';
import { newId } from '../ids.ts';

export interface RunBinding {
  token: string;
  runId: string;
  agentId: string;
  workspaceId: string;
  campaignId?: string;
  taskId?: string;
  /** Hội thoại Director mà lượt chat/briefing trả lời vào. */
  conversationId?: string;
  purpose: RunPurpose;
  /** Lượt task: đã nộp kết quả; lượt Director: đã trả lời chủ công ty. */
  submitted: boolean;
}

interface KindInfo {
  stage: StageName;
  role: AgentRole;
  artifact: string;
}
export const KIND_INFO: Record<TaskKind, KindInfo> = {
  'research.trend': { stage: 'research', role: 'researcher', artifact: 'research_report' },
  'research.competitor': { stage: 'research', role: 'researcher', artifact: 'research_report' },
  'research.audience': { stage: 'research', role: 'researcher', artifact: 'research_report' },
  'research.synthesis': { stage: 'research', role: 'coordinator', artifact: 'research_synthesis' },
  planning: { stage: 'research', role: 'coordinator', artifact: 'plan' },
  ideation: { stage: 'scripting', role: 'creative', artifact: 'idea_set' },
  script: { stage: 'scripting', role: 'scriptwriter', artifact: 'script' },
  'video.prompt': { stage: 'video', role: 'video_producer', artifact: 'video_prompt' },
  'video.template_render': { stage: 'video', role: 'video_producer', artifact: 'render_spec' },
  caption: { stage: 'publishing', role: 'publisher', artifact: 'caption' },
  publish: { stage: 'publishing', role: 'publisher', artifact: 'publish_note' },
  analysis: { stage: 'analytics', role: 'analyst', artifact: 'analysis' },
};
const RESEARCH_REPORT_KINDS = new Set<string>(['research.trend', 'research.competitor', 'research.audience']);

/** Năng lực cần cho từng công cụ; rỗng = chỉ cần là người được giao task của lượt chạy. */
export const TOOL_CAPABILITY: Record<string, string> = {
  task_create: 'task.manage',
  review_record: 'task.manage',
  task_submit: '',
  user_reply: 'user.converse',
  user_ask: 'user.converse',
  campaign_update_brief: 'campaign.brief.write',
  campaign_handoff: 'campaign.brief.write',
};

export const PURPOSE_TOOLS: Partial<Record<RunPurpose, string[]>> = {
  planning: ['task_create'],
  review: ['review_record'],
  task: ['task_submit'],
  chat: ['user_reply', 'user_ask'],
  briefing: ['user_reply', 'user_ask', 'campaign_update_brief', 'campaign_handoff'],
};
const REPLY_TOOLS = new Set(['task_submit', 'user_reply', 'user_ask']);
const SCRIPTS_PER_ROUND = 3;

const TOOLS: Record<string, { name: string; description: string; inputSchema: object }> = {
  task_create: {
    name: 'task_create',
    description: 'Tạo task trong bước đang chạy của chiến dịch và (tuỳ chọn) giao cho một Agent theo tên.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { enum: Object.keys(KIND_INFO) },
        title: { type: 'string' },
        instructions: { type: 'string' },
        assignee_name: { type: 'string' },
        depends_on: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'title', 'instructions'],
    },
  },
  task_submit: {
    name: 'task_submit',
    description: 'Nộp kết quả task đang làm. Nghiên cứu: mỗi phát hiện có nguồn (url http/https), nội dung và độ tin cậy (D-4).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        duration_seconds: { type: 'number', description: 'Chỉ task video.prompt: thời lượng clip (giây), trong giới hạn của nơi tạo video.' },
        aspect_ratio: { type: 'string', description: 'Chỉ task video.prompt: tỉ lệ khung hình, "9:16".' },
        captions: {
          type: 'array',
          description: 'Chỉ task caption: mỗi nền tảng trong danh sách của task một mục.',
          items: {
            type: 'object',
            properties: { platform: { enum: ['facebook', 'instagram', 'tiktok'] }, text: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } },
            required: ['platform', 'text'],
          },
        },
        reference_image_ids: { type: 'array', items: { type: 'string' }, description: 'Chỉ task video.prompt: id ảnh tham chiếu chọn từ danh sách ứng viên.' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: { url: { type: 'string' }, claim: { type: 'string' }, confidence: { enum: ['low', 'medium', 'high'] } },
            required: ['url', 'claim', 'confidence'],
          },
        },
      },
      required: ['content'],
    },
  },
  user_reply: {
    name: 'user_reply',
    description: 'Gửi câu trả lời cho chủ công ty.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  user_ask: {
    name: 'user_ask',
    description: 'Hỏi chủ công ty để làm rõ; nhiều ý thì gộp vào một tin, đánh số từng câu.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  campaign_update_brief: {
    name: 'campaign_update_brief',
    description: 'Ghi thông tin brief của chiến dịch đang làm rõ. Chỉ gửi các trường đã biết.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        goal: { type: 'string' },
        audience: { type: 'string' },
        product: { type: 'string' },
        platforms: { type: 'array', items: { enum: ['tiktok', 'facebook', 'instagram'] } },
        notes: { type: 'string' },
      },
      required: ['campaign_id'],
    },
  },
  campaign_handoff: {
    name: 'campaign_handoff',
    description: 'Bàn giao chiến dịch cho Coordinator khi brief đã đủ mục tiêu, đối tượng, sản phẩm, nền tảng.',
    inputSchema: { type: 'object', properties: { campaign_id: { type: 'string' } }, required: ['campaign_id'] },
  },
  review_record: {
    name: 'review_record',
    description:
      'Đánh giá task đang chờ review: pass; pass_with_limits (chấp nhận, ghi rõ giới hạn khi phần thiếu không thể có được); rework (kèm góp ý cụ thể).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        verdict: { enum: ['pass', 'pass_with_limits', 'rework'] },
        feedback: { type: 'string' },
        limits: { type: 'string' },
      },
      required: ['task_id', 'verdict'],
    },
  },
};

class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg);
};
const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export class Gateway {
  private readonly runs = new Map<string, RunBinding>();

  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  register(b: Omit<RunBinding, 'token' | 'submitted'>): RunBinding {
    const binding: RunBinding = { ...b, token: randomBytes(32).toString('hex'), submitted: false };
    this.runs.set(binding.token, binding);
    return binding;
  }

  release(token: string): RunBinding | undefined {
    const b = this.runs.get(token);
    this.runs.delete(token);
    return b;
  }

  handle(token: string, req: { method: string; params?: { name?: string; arguments?: Record<string, unknown> } }): unknown {
    const b = this.runs.get(token);
    if (!b) return text('Lượt chạy không hợp lệ', true);
    if (req.method === 'tools/list') return { tools: (PURPOSE_TOOLS[b.purpose] ?? []).map((n) => TOOLS[n]) };
    if (req.method !== 'tools/call') return {};
    return this.call(b, req.params?.name ?? '', req.params?.arguments ?? {}, false);
  }

  /**
   * Chạy lại một lời gọi công cụ đã lưu trong Approval `out_of_permission` (TK3 mục 5), nhân danh Agent. Vẫn qua kiểm
   * phạm vi và vòng đời; `skipCapability` khi người dùng cho phép một lần. Lỗi → ném Error.
   */
  runAs(agentId: string, workspaceId: string, campaignId: string | undefined, tool: string, args: Record<string, unknown>, skipCapability: boolean): string {
    const purpose = (Object.keys(PURPOSE_TOOLS) as RunPurpose[]).find((p) => PURPOSE_TOOLS[p]!.includes(tool));
    if (!purpose) throw new Error(`Không chạy lại được công cụ ${tool}`);
    const b: RunBinding = { token: '', runId: `approval`, agentId, workspaceId, campaignId, purpose, submitted: false };
    const r = this.call(b, tool, args, skipCapability) as { isError?: boolean; content: { text: string }[] };
    if (r.isError) throw new Error(r.content[0]?.text ?? 'lỗi');
    return r.content[0]?.text ?? '';
  }

  private call(b: RunBinding, name: string, args: Record<string, unknown>, skipCapability: boolean): unknown {
    const actor = `agent:${b.agentId}` as const;
    const record = (u: UnitOfWork, result: 'allowed' | 'denied', reason?: string) =>
      u.audit({ workspaceId: b.workspaceId, campaignId: b.campaignId, actor, action: `tool.${name}`, result, reason, cliRunId: b.runId, details: { arguments: args } });

    try {
      const out = runTx(this.deps, (u) => {
        if (!(PURPOSE_TOOLS[b.purpose] ?? []).includes(name)) fail(`Không dùng được ${name} trong lượt ${b.purpose}`);
        const agent = u.tx.select().from(agents).where(eq(agents.id, b.agentId)).get()!;
        const cap = TOOL_CAPABILITY[name];
        if (cap && !skipCapability && !agent.permissions.includes(cap)) {
          const id = newId();
          u.tx
            .insert(approvals)
            .values({
              id,
              workspaceId: b.workspaceId,
              campaignId: b.campaignId,
              kind: 'out_of_permission',
              subject: { tool: name, arguments: args, agentId: b.agentId, capability: cap },
              requestedByAgentId: b.agentId,
              status: 'pending',
              createdAt: u.now,
              updatedAt: u.now,
            })
            .run();
          u.emit({
            type: 'approval.requested',
            workspaceId: b.workspaceId,
            campaignId: b.campaignId,
            entity: { kind: 'approval', id },
            actor,
            data: { kind: 'out_of_permission', subject: { kind: 'action', ids: [id] } },
          });
          u.touchAgents([b.agentId]);
          record(u, 'denied', `thiếu năng lực ${cap}`);
          return { pendingApproval: true };
        }
        const message = this.execute(u, b, name, args);
        record(u, 'allowed');
        return { message };
      });
      if ('pendingApproval' in out) return text(`Cần người dùng duyệt: Agent chưa có quyền dùng ${name}. Đã gửi yêu cầu.`, true);
      if (REPLY_TOOLS.has(name)) b.submitted = true;
      return text(out.message);
    } catch (err) {
      if (!(err instanceof ToolError) && !(err instanceof Error)) throw err;
      runTx(this.deps, (u) => record(u, 'denied', err.message));
      return text(`Bị từ chối: ${err.message}`, true);
    }
  }

  private execute(u: UnitOfWork, b: RunBinding, name: string, args: Record<string, unknown>): string {
    const actor = `agent:${b.agentId}` as const;
    const director = this.directorTool(u, b, name, args);
    if (director !== undefined) return director;
    const campaign = b.campaignId ? u.tx.select().from(campaigns).where(eq(campaigns.id, b.campaignId)).get() : undefined;
    if (!campaign) fail('Lượt chạy không gắn chiến dịch');
    switch (name) {
      case 'task_create': {
        const kind = String(args.kind) as TaskKind;
        const info = KIND_INFO[kind] ?? fail(`Loại task không hợp lệ: ${String(args.kind)}`);
        if (info.stage !== campaign!.currentStage) fail(`Loại ${kind} không thuộc bước đang chạy (${campaign!.currentStage})`);
        if (kind === 'script') {
          // Đúng 3 kịch bản mỗi vòng (spec phần 3): đếm task script của vòng hiện tại chưa thất bại/huỷ.
          const since = u.tx.select({ s: campaignStages.startedAt }).from(campaignStages).where(and(eq(campaignStages.campaignId, campaign!.id), eq(campaignStages.stage, 'scripting'))).get()?.s ?? 0;
          const scripts = u.tx
            .select({ status: tasks.status, createdAt: tasks.createdAt })
            .from(tasks)
            .where(and(eq(tasks.campaignId, campaign!.id), eq(tasks.kind, 'script')))
            .all()
            .filter((t) => t.createdAt >= since && t.status !== 'failed' && t.status !== 'cancelled');
          if (scripts.length >= SCRIPTS_PER_ROUND) fail('Đã đủ 3 kịch bản cho vòng này');
        }
        let assignee: string | undefined;
        if (args.assignee_name) {
          const who = u.tx
            .select()
            .from(agents)
            .where(and(eq(agents.workspaceId, b.workspaceId), eq(agents.name, String(args.assignee_name))))
            .get();
          if (!who || who.roleTemplate !== info.role) fail(`Không có ${info.role} tên ${String(args.assignee_name)}`);
          assignee = who!.id;
        }
        const dependsOn = Array.isArray(args.depends_on) ? args.depends_on.map(String) : [];
        for (const d of dependsOn) {
          const dep = u.tx.select({ c: tasks.campaignId }).from(tasks).where(eq(tasks.id, d)).get();
          if (dep?.c !== campaign!.id) fail(`Task phụ thuộc ${d} không thuộc chiến dịch này`);
        }
        const id = newId();
        u.tx
          .insert(tasks)
          .values({
            id,
            campaignId: campaign!.id,
            stage: info.stage,
            kind,
            requiredRole: info.role,
            assigneeAgentId: assignee,
            input: { title: String(args.title), instructions: String(args.instructions) },
            dependsOn,
            status: 'queued',
            createdAt: u.now,
            updatedAt: u.now,
          })
          .run();
        u.emit({
          type: 'task.created',
          workspaceId: b.workspaceId,
          campaignId: campaign!.id,
          entity: { kind: 'task', id },
          actor,
          data: { kind, stage: info.stage, requiredRole: info.role, dependsOn },
        });
        u.touchAgents([assignee]);
        return `Đã tạo task ${id}.`;
      }
      case 'task_submit': {
        if (!b.taskId) fail('Lượt chạy không gắn task');
        const task = u.tx.select().from(tasks).where(eq(tasks.id, b.taskId!)).get();
        if (!task || task.campaignId !== campaign!.id || task.assigneeAgentId !== b.agentId) fail('Không phải task của lượt chạy này');
        if (task!.status !== 'running') fail(`Task đang ${task!.status}, không nộp được`);
        const sources = (Array.isArray(args.sources) ? args.sources : []) as Source[];
        if (RESEARCH_REPORT_KINDS.has(task!.kind) && sources.length === 0) fail('Kết quả nghiên cứu cần ít nhất một nguồn (D-4)');
        const errors = validateSources(sources);
        if (errors.length > 0) fail(errors.join('; '));
        const kind = KIND_INFO[task!.kind as TaskKind].artifact;
        const id = newId();
        const content =
          task!.kind === 'video.prompt' ? this.videoPromptContent(task!.input, args) : task!.kind === 'caption' ? this.captionContent(task!.input, args) : { text: String(args.content ?? ''), sources };
        u.tx
          .insert(artifacts)
          .values({ id, taskId: task!.id, campaignId: campaign!.id, kind, content, createdByAgentId: b.agentId, createdAt: u.now })
          .run();
        u.emit({ type: 'artifact.created', workspaceId: b.workspaceId, campaignId: campaign!.id, entity: { kind: 'artifact', id }, actor, data: { kind, taskId: task!.id } });
        return 'Đã nhận kết quả.';
      }
      case 'review_record': {
        const task = u.tx.select().from(tasks).where(eq(tasks.id, String(args.task_id))).get();
        if (!task || task.campaignId !== campaign!.id) fail(`Không có task ${String(args.task_id)} trong chiến dịch`);
        if (task!.status !== 'in_review') fail(`Task ${task!.id} không chờ review`);
        const verdict = String(args.verdict) as ReviewVerdict;
        if (!['pass', 'pass_with_limits', 'rework'].includes(verdict)) fail(`Kết quả review không hợp lệ: ${verdict}`);
        const feedback = args.feedback === undefined ? undefined : String(args.feedback);
        const limits = args.limits === undefined ? undefined : String(args.limits);
        u.tx.insert(reviews).values({ id: newId(), taskId: task!.id, attempt: task!.attempt, verdict, feedback, limits, cliRunId: b.runId, createdAt: u.now }).run();
        const to = reviewOutcome(verdict, task!.attempt);
        // in_review → failed là việc của hệ thống khi hết lượt làm lại (TK2 4.3).
        u.transition({ entity: 'task', id: task!.id, to, actor: to === 'failed' ? 'system' : actor, ctx: { attempt: task!.attempt } });
        if (to === 'queued') {
          u.tx
            .update(tasks)
            .set({ attempt: Math.min(task!.attempt + 1, MAX_ATTEMPTS), cliFailures: 0, input: { ...task!.input, feedback } })
            .where(eq(tasks.id, task!.id))
            .run();
        }
        u.emit({
          type: 'review.recorded',
          workspaceId: b.workspaceId,
          campaignId: campaign!.id,
          entity: { kind: 'review', id: task!.id },
          actor,
          data: { taskId: task!.id, verdict, attempt: task!.attempt, ...(limits ? { limits } : {}) },
        });
        return `Đã ghi ${verdict} cho ${task!.id}.`;
      }
    }
    return fail(`Không biết công cụ ${name}`);
  }

  /** Kiểm caption: đúng mỗi nền tảng trong input.platforms một mục, caption không rỗng và không vượt giới hạn. */
  private captionContent(input: Record<string, unknown>, args: Record<string, unknown>) {
    const wanted = (Array.isArray(input.platforms) ? input.platforms : []).map(String);
    const list = (Array.isArray(args.captions) ? args.captions : []) as { platform?: unknown; text?: unknown; hashtags?: unknown }[];
    const got = list.map((c) => String(c?.platform));
    const missing = wanted.filter((p) => !got.includes(p));
    const extra = got.filter((p) => !wanted.includes(p));
    if (missing.length > 0 || extra.length > 0 || new Set(got).size !== got.length)
      fail(`captions phải có đúng một mục cho mỗi nền tảng: ${wanted.join(', ')}${missing.length ? ` (thiếu ${missing.join(', ')})` : ''}${extra.length ? ` (thừa ${extra.join(', ')})` : ''}`);
    const captions = list.map((c) => {
      const text = String(c.text ?? '').trim();
      if (!text) fail(`Caption ${String(c.platform)} trống`);
      const hashtags = (Array.isArray(c.hashtags) ? c.hashtags : []).map(String);
      if (composeCaption(text, hashtags).length > CAPTION_MAX_LENGTH) fail(`Caption ${String(c.platform)} dài quá ${CAPTION_MAX_LENGTH} ký tự`);
      return { platform: String(c.platform), text, hashtags };
    });
    return { text: captions.map((c) => `${c.platform}: ${composeCaption(c.text, c.hashtags)}`).join('\n\n'), captions };
  }

  /** Kiểm prompt video theo trần của nơi tạo video đã chọn (ghi trong input task) rồi dựng nội dung artifact. */
  private videoPromptContent(input: Record<string, unknown>, args: Record<string, unknown>) {
    const tool = videoToolById(String(input.toolId)) ?? fail(`Task không có nơi tạo video hợp lệ: ${String(input.toolId)}`);
    const candidates = (Array.isArray(input.referenceCandidates) ? input.referenceCandidates : []) as MessageAttachment[];
    const ids = Array.isArray(args.reference_image_ids) ? args.reference_image_ids.map(String) : [];
    const limits = `Giới hạn của ${tool!.label}: một clip ${tool!.minSeconds}–${tool!.maxSeconds} giây, ${tool!.aspectRatio}, tối đa ${tool!.maxReferenceImages} ảnh tham chiếu.`;
    const unknown = ids.filter((id) => !candidates.some((c) => c.id === id));
    if (unknown.length > 0) fail(`Ảnh tham chiếu không thuộc danh sách ứng viên của chiến dịch: ${unknown.join(', ')}. ${limits} Viết lại rồi nộp lại.`);
    const errors = checkVideoSpec(tool!, { durationSeconds: args.duration_seconds, aspectRatio: args.aspect_ratio, referenceImageCount: new Set(ids).size });
    if (errors.length > 0) fail(`${errors.join('; ')}. ${limits} Viết lại rồi nộp lại.`);
    const text = String(args.content ?? '').trim();
    if (!text) fail('Prompt video trống');
    return {
      // Câu khổ dọc/thời lượng do mã bảo đảm (không chỉ dựa vào Agent tự viết): người dùng dán nguyên văn bản này sang Gemini.
      text: withVideoDirective(text, tool!, args.duration_seconds as number),
      durationSeconds: args.duration_seconds as number,
      aspectRatio: tool!.aspectRatio,
      toolId: tool!.id,
      scriptArtifactId: input.scriptArtifactId ?? null,
      referenceImages: [...new Set(ids)].map((id) => candidates.find((c) => c.id === id)!),
    };
  }

  /** Công cụ của Director; trả `undefined` nếu không phải công cụ Director. */
  private directorTool(u: UnitOfWork, b: RunBinding, name: string, args: Record<string, unknown>): string | undefined {
    const actor = `agent:${b.agentId}` as const;
    const workspaceCampaign = () => {
      const c = u.tx.select().from(campaigns).where(eq(campaigns.id, String(args.campaign_id))).get();
      if (!c || c.workspaceId !== b.workspaceId) fail(`Không có chiến dịch ${String(args.campaign_id)}`);
      if (b.campaignId && c!.id !== b.campaignId) fail('Lượt này chỉ làm việc với chiến dịch của hội thoại hiện tại');
      return c!;
    };
    switch (name) {
      case 'user_reply':
      case 'user_ask': {
        if (!b.campaignId) fail('Lượt này không gắn chiến dịch');
        const conv =
          (b.conversationId && u.tx.select().from(conversations).where(eq(conversations.id, b.conversationId)).get()) ||
          u.tx.select().from(conversations).where(and(eq(conversations.workspaceId, b.workspaceId), isNull(conversations.agentId))).get();
        if (!conv) fail('Không có hội thoại Director');
        const content = String(name === 'user_ask' ? args.question : args.text ?? '').trim();
        if (!content) fail('Nội dung trống');
        const id = newId();
        u.tx
          .insert(messages)
          .values({ id, conversationId: conv!.id, role: 'agent', agentId: b.agentId, campaignId: b.campaignId, content, kind: name === 'user_ask' ? 'question' : 'chat', createdAt: u.now })
          .run();
        u.emit({ type: 'message.created', workspaceId: b.workspaceId, campaignId: b.campaignId, entity: { kind: 'message', id }, actor, data: { conversationId: conv!.id, role: 'agent', agentId: b.agentId } });
        u.touchAgents([b.agentId]);
        return 'Đã gửi.';
      }
      case 'campaign_update_brief': {
        const c = workspaceCampaign();
        if (c.status !== 'briefing') fail('Chiến dịch đã bàn giao; đổi brief cần chủ công ty duyệt');
        const patch: Record<string, unknown> = {};
        for (const k of ['goal', 'audience', 'product', 'notes'] as const) if (typeof args[k] === 'string') patch[k] = args[k];
        if (Array.isArray(args.platforms)) patch.platforms = args.platforms.filter((p) => ['tiktok', 'facebook', 'instagram'].includes(String(p)));
        u.tx.update(campaigns).set({ brief: { ...c.brief, ...patch }, updatedAt: u.now }).where(eq(campaigns.id, c.id)).run();
        return 'Đã ghi brief.';
      }
      case 'campaign_handoff': {
        const c = workspaceCampaign();
        activateCampaign(u, c.id, actor);
        return 'Đã bàn giao cho Coordinator.';
      }
    }
    return undefined;
  }
}
