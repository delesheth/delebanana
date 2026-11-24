// DTO của API HTTP luồng Campaign (GET /campaigns, GET /campaigns/:id, tin nhắn Director). Khớp cột trong
// apps/server/src/db/schema.ts; thời gian là ms epoch, cột JSON giữ nguyên dạng object.

import type { ApprovalKind, ApprovalStatus } from './lifecycle/approval.ts';
import type { CampaignStatus } from './lifecycle/campaign.ts';
import type { StageName, StageStatus } from './lifecycle/stage.ts';
import type { TaskKind, TaskStatus } from './lifecycle/task.ts';
import type { VideoVersionStatus } from './lifecycle/videoVersion.ts';
import type { AgentRole } from './states.ts';

export interface CampaignRow {
  id: string;
  workspaceId: string;
  title: string;
  brief: Record<string, unknown>;
  stages: StageName[];
  status: CampaignStatus;
  currentStage: StageName | null;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignStageRow {
  id: string;
  campaignId: string;
  stage: StageName;
  status: StageStatus;
  summary: string | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskRow {
  id: string;
  campaignId: string;
  stage: StageName;
  kind: TaskKind;
  requiredRole: AgentRole;
  assigneeAgentId: string | null;
  input: Record<string, unknown>;
  dependsOn: string[];
  priority: number;
  status: TaskStatus;
  attempt: number;
  cliFailures: number;
  failureSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** `GET /tasks/:id`: task kèm tên Campaign (bảng thông tin nhân vật). */
export interface TaskInfo {
  task: TaskRow;
  campaignTitle: string;
}

export interface ArtifactRow {
  id: string;
  taskId: string | null;
  campaignId: string;
  kind: string;
  content: Record<string, unknown>;
  createdByAgentId: string | null;
  createdAt: number;
}

export interface ApprovalRow {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  kind: ApprovalKind;
  subject: Record<string, unknown>;
  requestedByAgentId: string | null;
  status: ApprovalStatus;
  decision: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

/** Phản hồi GET /campaigns/:id. */
export interface CampaignDetail {
  campaign: CampaignRow;
  stages: CampaignStageRow[];
  tasks: TaskRow[];
  artifacts: ArtifactRow[];
  approvals: ApprovalRow[];
}

/** Ảnh đính kèm tin nhắn; tải về qua `GET /uploads/:id`. */
export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'agent' | 'system';
  agentId: string | null;
  campaignId: string | null;
  content: string;
  attachments: MessageAttachment[] | null;
  /** `chat`, `question`, `proposal_to_director`. */
  kind: string;
  createdAt: number;
}

/** Phiên bản video người dùng tải lên cho một Approval `make_video` (manual); tệp phục vụ qua `GET /videos/:id/file`. */
export interface VideoVersionRow {
  id: string;
  campaignId: string;
  videoId: string;
  makeVideoApprovalId: string;
  number: number;
  provider: 'manual';
  toolId: string;
  status: VideoVersionStatus;
  path: string | null;
  mime: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown> | null;
  invalidReasons: string[] | null;
  createdAt: number;
  updatedAt: number;
}

/** Phiên bản video mới nhất gắn vào Approval make_video/approve_video trong `GET /approvals` (không có đường dẫn tệp). */
export type LatestVideo = Pick<VideoVersionRow, 'id' | 'number' | 'status' | 'invalidReasons' | 'sizeBytes' | 'mime'>;
