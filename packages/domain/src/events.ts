// Sự kiện của Event Bus (M11) — docs/design/02-lifecycle-events.md mục 6. Backend ghi mỗi sự kiện vào bảng
// `events` trong cùng giao dịch với thay đổi dữ liệu; client áp bằng reducer theo `seq`.

import type { RunPurpose } from './deriveAgentState.ts';
import type { ApprovalKind, ApprovalStatus } from './lifecycle/approval.ts';
import type { CampaignStatus, Platform } from './lifecycle/campaign.ts';
import type { PostStatus } from './lifecycle/post.ts';
import type { StageName, StageStatus } from './lifecycle/stage.ts';
import type { ReviewVerdict, TaskKind, TaskStatus } from './lifecycle/task.ts';
import type { VideoVersionStatus } from './lifecycle/videoVersion.ts';
import type { Actor } from './machine.ts';
import type { AgentRole, AgentState } from './states.ts';

export type EntityKind =
  | 'agent'
  | 'campaign'
  | 'stage'
  | 'task'
  | 'review'
  | 'artifact'
  | 'approval'
  | 'video_version'
  | 'post'
  | 'meeting'
  | 'message'
  | 'cli_run'
  | 'memory';

interface Change<S> {
  from: S;
  to: S;
}

/**
 * Dữ liệu theo từng loại sự kiện (TK2 mục 6.2). Đầu ra CLI trực tiếp (`cli_run.output`) không có ở đây:
 * đó là kênh riêng, không ghi bảng `events`, không có `seq`.
 */
export interface EventDataMap {
  'agent.state_changed': { state: AgentState; taskId?: string; cliRunId?: string; meetingId?: string };
  'agent.config_changed': { fields: string[] };
  'campaign.created': { title: string };
  'campaign.status_changed': Change<CampaignStatus>;
  /** Người dùng xoá chiến dịch (kèm mọi bước, task, kết quả, yêu cầu duyệt của nó). */
  'campaign.deleted': { title: string };
  'stage.status_changed': Change<StageStatus> & { stage: StageName };
  'task.created': { kind: TaskKind; stage: StageName; requiredRole: AgentRole; dependsOn: string[] };
  'task.status_changed': Change<TaskStatus> & { assigneeAgentId?: string; attempt: number };
  'review.recorded': { taskId: string; verdict: ReviewVerdict; attempt: number; limits?: string };
  'artifact.created': { kind: string; taskId: string };
  'approval.requested': { kind: ApprovalKind; subject: { kind: EntityKind | 'action'; ids: string[] } };
  'approval.decided': { status: Exclude<ApprovalStatus, 'pending'>; decision?: unknown };
  'video_version.status_changed': Change<VideoVersionStatus> & { videoId: string; number: number };
  'post.status_changed': Change<PostStatus> & { platform: Platform };
  'meeting.started': { participantAgentIds: string[]; topic: string };
  'meeting.ended': { participantAgentIds: string[]; topic: string };
  'message.created': { conversationId: string; role: 'user' | 'agent' | 'system'; agentId?: string; text?: string };
  'memory.created': { owner: MemoryOwner; type: MemoryType; status: MemoryStatus };
  'memory.status_changed': Change<MemoryStatus>;
  'cli_run.started': { agentId: string; purpose: RunPurpose };
  'cli_run.finished': { agentId: string; purpose: RunPurpose; outcome: 'ok' | 'error' | 'quota_exhausted' | 'timeout'; usage?: Record<string, number> };
}

export type MemoryOwner = 'agent' | 'shared';
export type MemoryType = 'preference' | 'lesson' | 'insight' | 'fact' | 'note';
export type MemoryStatus = 'active' | 'proposed' | 'archived';

export type EventType = keyof EventDataMap;

const EVENT_TYPE_KEYS: Record<EventType, true> = {
  'agent.state_changed': true,
  'agent.config_changed': true,
  'campaign.created': true,
  'campaign.status_changed': true,
  'campaign.deleted': true,
  'stage.status_changed': true,
  'task.created': true,
  'task.status_changed': true,
  'review.recorded': true,
  'artifact.created': true,
  'approval.requested': true,
  'approval.decided': true,
  'video_version.status_changed': true,
  'post.status_changed': true,
  'meeting.started': true,
  'meeting.ended': true,
  'message.created': true,
  'memory.created': true,
  'memory.status_changed': true,
  'cli_run.started': true,
  'cli_run.finished': true,
};

/** Mọi loại sự kiện (SSE đặt tên theo loại nên client phải đăng ký từng tên). Kiểu `Record` buộc đủ khoá khi `EventDataMap` đổi. */
export const EVENT_TYPES = Object.keys(EVENT_TYPE_KEYS) as EventType[];

export interface DomainEvent<T extends EventType = EventType> {
  /** Tăng dần toàn hệ thống, khoá chính bảng `events`. */
  seq: number;
  /** ms epoch. */
  at: number;
  type: T;
  workspaceId: string;
  campaignId?: string;
  entity: { kind: EntityKind; id: string };
  actor: Actor;
  data: EventDataMap[T];
}

export interface AgentStatus {
  state: AgentState;
  since: number;
  taskId?: string;
}

/** Trạng thái phía client (UI, 3D) dựng từ snapshot + sự kiện. */
export interface ClientState {
  lastSeq: number;
  agents: Readonly<Record<string, AgentStatus>>;
  /** Phát hiện hở số thứ tự: cần lấy snapshot mới (rủi ro T4). */
  needsResync: boolean;
}

export const emptyClientState: ClientState = { lastSeq: 0, agents: {}, needsResync: false };

function isType<T extends EventType>(e: DomainEvent, type: T): e is DomainEvent<T> {
  return e.type === type;
}

/** Áp một sự kiện; bỏ qua sự kiện cũ hoặc trùng theo `seq`. */
export function applyEvent(s: ClientState, e: DomainEvent): ClientState {
  if (e.seq <= s.lastSeq) return s;
  const next: ClientState = { ...s, lastSeq: e.seq, needsResync: s.needsResync || e.seq > s.lastSeq + 1 };
  if (isType(e, 'agent.state_changed')) {
    next.agents = { ...s.agents, [e.entity.id]: { state: e.data.state, since: e.at, taskId: e.data.taskId } };
  }
  return next;
}

export interface ClientSnapshot {
  seq: number;
  agents: Record<string, AgentStatus>;
}

/** Thay toàn bộ trạng thái bằng snapshot (khi kết nối lại); snapshot cũ hơn bị bỏ qua. */
export function applySnapshot(s: ClientState, snap: ClientSnapshot): ClientState {
  if (snap.seq < s.lastSeq) return s;
  return { lastSeq: snap.seq, agents: { ...snap.agents }, needsResync: false };
}

export interface RosterEntry {
  id: string;
  workspaceId: string;
  name: string;
  role: AgentRole;
  title: string;
}

/** Phản hồi `GET /snapshot` của server: trạng thái Agent kèm danh sách nhân sự và Workspace. */
export interface ServerSnapshot extends ClientSnapshot {
  workspaces: { id: string; name: string }[];
  roster: RosterEntry[];
}
