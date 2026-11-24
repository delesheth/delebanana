// Trạng thái Agent suy ra từ dữ liệu thật (TK2 mục 5). Không lưu DB; backend tính lại khi dữ kiện đổi
// và chỉ phát `agent.state_changed` khi kết quả khác lần trước.

import type { TaskKind } from './lifecycle/task.ts';
import { WORK_STATES, type AgentRole, type AgentState } from './states.ts';

/** `reflection`: lượt suy ngẫm rút bài học vào bộ nhớ (TK4 mục 6). */
export type RunPurpose = 'task' | 'review' | 'chat' | 'planning' | 'briefing' | 'reflection';

export interface AgentFacts {
  role: AgentRole;
  enabled: boolean;
  inMeeting: boolean;
  /** Bị chặn vì hết hạn mức gói thuê bao hoặc giới hạn đồng thời (→ TK3). */
  blocked: boolean;
  activeRun?: { purpose: RunPurpose; taskKind?: TaskKind };
  /** Loại task đang `running` của Agent (có thể lượt CLI chưa bắt đầu — tránh nhịp `idle` giả, S5). */
  runningTaskKind?: TaskKind;
  hasWaitingTask: boolean;
  hasAssignedTask: boolean;
  /** Director đã hỏi người dùng và chưa có trả lời. */
  awaitingUserReply: boolean;
  /** Có Approval `pending` do chính Agent yêu cầu. */
  hasPendingApproval: boolean;
  /** Task gần nhất `failed` và người dùng chưa xem. */
  unseenFailure: boolean;
}

const KIND_STATE: Record<TaskKind, AgentState> = {
  'research.trend': 'researching',
  'research.competitor': 'researching',
  'research.audience': 'researching',
  'research.synthesis': 'planning',
  planning: 'planning',
  ideation: 'brainstorming',
  script: 'writing',
  caption: 'writing',
  'video.prompt': 'writing',
  'video.template_render': 'generating_video',
  publish: 'publishing',
  analysis: 'analyzing',
};

/** Trạng thái khi Agent đang có lượt CLI chạy (bảng "Lượt CLI đang chạy" của TK2 mục 5). */
export function runState(role: AgentRole, run: NonNullable<AgentFacts['activeRun']>): AgentState {
  if (role === 'director') return 'conversing';
  if (role === 'coordinator') return run.purpose === 'review' ? 'reviewing' : 'planning';
  if (run.taskKind) return KIND_STATE[run.taskKind];
  return WORK_STATES[role][0]!;
}

export function deriveAgentState(f: AgentFacts): AgentState {
  if (!f.enabled) return 'offline';
  if (f.inMeeting) return 'in_meeting';
  if (f.blocked) return 'blocked_budget';
  // Lượt chat (hỏi đáp, D-1) của Agent chuyên môn không phải làm việc: coi như không có lượt chạy
  // để các dòng thấp hơn (chờ video, chờ duyệt, lỗi) vẫn hiện đúng.
  const specialistChat = f.activeRun?.purpose === 'chat' && f.role !== 'director' && f.role !== 'coordinator';
  if (f.activeRun && !specialistChat) return runState(f.role, f.activeRun);
  if (f.runningTaskKind) return runState(f.role, { purpose: 'task', taskKind: f.runningTaskKind });
  if (f.hasWaitingTask) return 'generating_video';
  if (f.hasAssignedTask) return 'assigned';
  if (f.awaitingUserReply) return 'awaiting_user_reply';
  if (f.hasPendingApproval) return 'waiting_approval';
  if (f.unseenFailure) return 'error';
  return 'idle';
}
