// Schema SQLite theo docs/design/01-domain-model.md (+ Meeting của TK2, AuditEntry của TK3).
// Khoá ULID dạng text; thời gian là ms epoch; cột JSON dùng text mode json. Bảng video, đăng bài, bộ nhớ thêm khi cần.

import type { MessageAttachment } from '@delebanana/domain';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull();
const updatedAt = () => integer('updated_at').notNull();
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  brandProfile: json<Record<string, unknown>>('brand_profile').notNull().default({}),
  limits: json<Record<string, unknown>>('limits').notNull().default({}),
  archivedAt: integer('archived_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agents = sqliteTable(
  'agents',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    roleTemplate: text('role_template').notNull(),
    title: text('title').notNull(),
    name: text('name').notNull(),
    appearance: json<Record<string, unknown>>('appearance').notNull().default({}),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    systemPrompt: text('system_prompt').notNull().default(''),
    tools: json<string[]>('tools').notNull().default([]),
    permissions: json<string[]>('permissions').notNull().default([]),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Bộ nhớ đệm trạng thái đã phát gần nhất (không phải nguồn sự thật, TK2 mục 5). */
    lastState: text('last_state'),
    lastStateAt: integer('last_state_at'),
    archivedAt: integer('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('agents_workspace').on(t.workspaceId)],
);

export const campaigns = sqliteTable('campaigns', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  title: text('title').notNull(),
  brief: json<Record<string, unknown>>('brief').notNull().default({}),
  stages: json<string[]>('stages').notNull(),
  status: text('status').notNull(),
  currentStage: text('current_stage'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaignStages = sqliteTable(
  'campaign_stages',
  {
    id: id(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id),
    stage: text('stage').notNull(),
    status: text('status').notNull(),
    summary: text('summary'),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('campaign_stages_campaign').on(t.campaignId)],
);

export const assets = sqliteTable('assets', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  kind: text('kind').notNull(),
  path: text('path'),
  url: text('url'),
  note: text('note'),
  addedBy: text('added_by').notNull(),
  createdAt: createdAt(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id),
    stage: text('stage').notNull(),
    kind: text('kind').notNull(),
    requiredRole: text('required_role').notNull(),
    assigneeAgentId: text('assignee_agent_id').references(() => agents.id),
    input: json<Record<string, unknown>>('input').notNull().default({}),
    dependsOn: json<string[]>('depends_on').notNull().default([]),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    /** Số lượt CLI thất bại trong lần thử hiện tại (thử lại tối đa MAX_CLI_RETRIES, TK2 4.3). */
    cliFailures: integer('cli_failures').notNull().default(0),
    /** Người dùng đã xem lỗi của task (TK2 mục 5, dòng 9). */
    failureSeenAt: integer('failure_seen_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_campaign').on(t.campaignId), index('tasks_assignee').on(t.assigneeAgentId, t.status)],
);

export const reviews = sqliteTable('reviews', {
  id: id(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  attempt: integer('attempt').notNull(),
  verdict: text('verdict').notNull(),
  feedback: text('feedback'),
  limits: text('limits'),
  cliRunId: text('cli_run_id'),
  createdAt: createdAt(),
});

export const artifacts = sqliteTable('artifacts', {
  id: id(),
  taskId: text('task_id').references(() => tasks.id),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  kind: text('kind').notNull(),
  content: json<Record<string, unknown>>('content').notNull(),
  createdByAgentId: text('created_by_agent_id').references(() => agents.id),
  createdAt: createdAt(),
});

export const approvals = sqliteTable('approvals', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  kind: text('kind').notNull(),
  subject: json<Record<string, unknown>>('subject').notNull(),
  requestedByAgentId: text('requested_by_agent_id').references(() => agents.id),
  status: text('status').notNull(),
  decision: json<Record<string, unknown>>('decision'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Phiên bản video người dùng tải lên cho một Approval make_video (provider `manual`); mỗi lần tải lại sau invalid/rejected là một dòng mới. */
export const videoVersions = sqliteTable(
  'video_versions',
  {
    id: id(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id),
    /** Id artifact `video_prompt` của video. */
    videoId: text('video_id').notNull(),
    makeVideoApprovalId: text('make_video_approval_id').notNull(),
    number: integer('number').notNull(),
    provider: text('provider').notNull(),
    toolId: text('tool_id').notNull(),
    status: text('status').notNull(),
    /** Tên tệp trong thư mục videos của dữ liệu; trống khi tệp đã xoá (invalid) hoặc chưa có. */
    path: text('path'),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    metadata: json<Record<string, unknown>>('metadata'),
    invalidReasons: json<string[]>('invalid_reasons'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('video_versions_campaign').on(t.campaignId), index('video_versions_video').on(t.videoId)],
);

export const conversations = sqliteTable('conversations', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  /** Trống = hội thoại với Director; có = tab Chat của Agent chuyên môn (D-1). */
  agentId: text('agent_id').references(() => agents.id),
  kind: text('kind').notNull(),
  createdAt: createdAt(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: id(),
    conversationId: text('conversation_id').notNull().references(() => conversations.id),
    role: text('role').notNull(),
    agentId: text('agent_id').references(() => agents.id),
    campaignId: text('campaign_id').references(() => campaigns.id),
    content: text('content').notNull(),
    /** Ảnh đính kèm (tệp trong thư mục uploads, phục vụ qua GET /uploads/:id). */
    attachments: json<MessageAttachment[]>('attachments'),
    /** `chat`, `question`, `proposal_to_director`. */
    kind: text('kind').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation').on(t.conversationId, t.createdAt), index('messages_thread').on(t.conversationId, t.campaignId, t.createdAt)],
);

export const meetings = sqliteTable('meetings', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  topic: text('topic').notNull(),
  participantAgentIds: json<string[]>('participant_agent_ids').notNull(),
  transcriptArtifactId: text('transcript_artifact_id'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
});

export const cliRuns = sqliteTable(
  'cli_runs',
  {
    id: id(),
    agentId: text('agent_id').notNull().references(() => agents.id),
    taskId: text('task_id').references(() => tasks.id),
    campaignId: text('campaign_id').references(() => campaigns.id),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    cliVersion: text('cli_version'),
    purpose: text('purpose').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    exitCode: integer('exit_code'),
    outcome: text('outcome'),
    usage: json<Record<string, unknown>>('usage'),
    logPath: text('log_path'),
  },
  (t) => [index('cli_runs_agent').on(t.agentId, t.endedAt)],
);

export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    type: text('type').notNull(),
    workspaceId: text('workspace_id').notNull(),
    campaignId: text('campaign_id'),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    actor: text('actor').notNull(),
    data: json<Record<string, unknown>>('data').notNull(),
  },
  (t) => [index('events_at').on(t.at)],
);

export const audit = sqliteTable(
  'audit',
  {
    id: id(),
    at: integer('at').notNull(),
    workspaceId: text('workspace_id').notNull(),
    campaignId: text('campaign_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetKind: text('target_kind'),
    targetId: text('target_id'),
    result: text('result').notNull(),
    reason: text('reason'),
    cliRunId: text('cli_run_id'),
    details: json<unknown>('details'),
  },
  (t) => [index('audit_at').on(t.at)],
);

/** Hạn mức gói thuê bao theo provider (TK3 mục 7, S5: đọc từ `rate_limit_event` của CLI). */
export const providerStatus = sqliteTable('provider_status', {
  provider: text('provider').primaryKey(),
  utilization5h: real('utilization_5h'),
  utilization7d: real('utilization_7d'),
  resetsAt: integer('resets_at'),
  /** Khoá giao lượt mới tới thời điểm này (ms); `Number.MAX_SAFE_INTEGER` = tới khi người dùng mở khoá. */
  blockedUntil: integer('blocked_until'),
  blockReason: text('block_reason'),
  warnedResetsAt: integer('warned_resets_at'),
  quotaBackoffMs: integer('quota_backoff_ms').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

// ---- Đăng bài (phiếu D) ----

/** App của nền tảng (Meta): App ID/Secret người dùng tự điền, lưu cục bộ (ngoài repo). Secret không bao giờ rời backend. */
export const platformApps = sqliteTable('platform_apps', {
  platform: text('platform').primaryKey(),
  appId: text('app_id').notNull(),
  appSecret: text('app_secret').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Tài khoản xã hội đã kết nối (Facebook Page). Token ở `socialCredentials` để không select nhầm. */
export const socialAccounts = sqliteTable(
  'social_accounts',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull(),
    tokenExpiresAt: integer('token_expires_at'),
    dataAccessExpiresAt: integer('data_access_expires_at'),
    scopes: json<string[]>('scopes').notNull().default([]),
    /** Instagram: tài khoản Facebook Page liên kết (dùng chung Page token); ngắt Page thì ngắt luôn. */
    parentAccountId: text('parent_account_id'),
    archivedAt: integer('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('social_accounts_workspace').on(t.workspaceId, t.platform)],
);

export const socialCredentials = sqliteTable('social_credentials', {
  accountId: text('account_id').primaryKey().references(() => socialAccounts.id),
  accessToken: text('access_token').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const posts = sqliteTable(
  'posts',
  {
    id: id(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id),
    approvalId: text('approval_id'),
    videoVersionId: text('video_version_id').notNull(),
    socialAccountId: text('social_account_id'),
    platform: text('platform').notNull(),
    /** `api` (Facebook) hoặc `manual` (đăng tay có hỗ trợ). */
    mode: text('mode').notNull(),
    caption: text('caption').notNull().default(''),
    captionArtifactId: text('caption_artifact_id'),
    status: text('status').notNull(),
    scheduledAt: integer('scheduled_at'),
    /** Số lần tự thử lại sau lỗi tạm thời (tối đa MAX_PUBLISH_RETRIES). */
    retries: integer('retries').notNull().default(0),
    /** Id video trên nền tảng (lưu ngay sau upload_phase=start để thử lại không đăng trùng). */
    platformPostId: text('platform_post_id'),
    permalink: text('permalink'),
    error: text('error'),
    /** Lần gọi API đăng gần nhất (ms) — đếm hạn mức 24 giờ cuốn chiếu. */
    apiCalledAt: integer('api_called_at'),
    /** Thời điểm (ms) đã gửi finish cho Meta; ghi TRƯỚC khi gọi để restart không upload/finish lần hai. Xoá khi video bị bỏ. */
    finishSentAt: integer('finish_sent_at'),
    /** Thời điểm (ms) người dùng bấm Thử lại trên bài đã gửi finish: gia hạn chờ Meta, hoặc finish lại nếu Meta vẫn 'uploading'. */
    finishRetriedAt: integer('finish_retried_at'),
    /** Instagram: thời điểm (ms) đã tải xong tệp vào container; thiếu thì lần chạy sau tải lại vào cùng container. */
    uploadedAt: integer('uploaded_at'),
    publishedAt: integer('published_at'),
    remindedAt: integer('reminded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('posts_campaign').on(t.campaignId), index('posts_status').on(t.status)],
);
