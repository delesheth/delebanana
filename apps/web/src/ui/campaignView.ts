// Diễn giải trạng thái Campaign thành lời cho người dùng (không cần biết task/artifact/stage là gì).

import type { CampaignDetail } from '@delebanana/domain';

export const CAMPAIGN_STATUS: Record<string, string> = {
  briefing: 'Đang trao đổi yêu cầu',
  active: 'Đang thực hiện',
  paused: 'Tạm dừng',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

export const STAGE_LABEL: Record<string, string> = {
  research: 'Nghiên cứu thị trường',
  scripting: 'Viết kịch bản',
  video: 'Sản xuất video',
  publishing: 'Đăng bài',
  analytics: 'Phân tích hiệu quả',
};

export type StepState = 'done' | 'running' | 'waiting_you' | 'todo';
export interface Step {
  stage: string;
  label: string;
  state: StepState;
}

/** Các bước của chiến dịch (bỏ bước không làm), theo thứ tự. */
export function stepsOf(d: CampaignDetail): Step[] {
  return d.stages
    .filter((s) => s.status !== 'skipped' && !(s.stage === 'video' && s.status === 'pending')) // video chỉ hiện khi người dùng bấm "Tạo video"
    .map((s) => ({
      stage: s.stage,
      label: STAGE_LABEL[s.stage] ?? s.stage,
      state: s.status === 'done' ? 'done' : s.status === 'awaiting_approval' ? 'waiting_you' : s.status === 'running' ? 'running' : 'todo',
    }));
}

export type NextAction =
  | { kind: 'chat'; text: string }
  | { kind: 'approve'; text: string }
  | { kind: 'wait'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'problem'; text: string };

/** Việc người dùng nên làm tiếp (hoặc đang chờ đội ngũ làm gì). */
export function nextAction(d: CampaignDetail): NextAction {
  const { campaign } = d;
  if (campaign.status === 'briefing')
    return { kind: 'chat', text: 'Dele đang hỏi thêm thông tin để chốt yêu cầu (mục tiêu, khách hàng, sản phẩm, nền tảng). Mở chat để trả lời.' };
  if (campaign.status === 'completed')
    return {
      kind: 'done',
      text: 'Chiến dịch đã xong phần kịch bản. Bạn có thể sao chép kịch bản đã chọn để quay video, hoặc nhắn Dele nếu muốn chỉnh thêm. Sản xuất video và đăng bài tự động sẽ có ở phiên bản sau.',
    };
  if (campaign.status === 'cancelled' || campaign.status === 'paused')
    return { kind: 'problem', text: 'Chiến dịch đang dừng. Nhắn Dele để hỏi lý do hoặc tạo chiến dịch mới.' };
  const current = d.stages.find((s) => s.stage === campaign.currentStage);
  const label = (STAGE_LABEL[current?.stage ?? ''] ?? 'công việc').toLowerCase();
  if (current?.stage === 'video' && current.status === 'awaiting_approval')
    return { kind: 'approve', text: 'Prompt video đã sẵn sàng. Xem mục "Chờ bạn duyệt" ở trên cùng: sao chép prompt, mở nơi tạo video và tự làm video. Tải video lên sẽ có ở phiên bản sau.' };
  if (current?.status === 'awaiting_approval') return { kind: 'approve', text: `Đội ngũ đã xong bước ${label} và đang chờ bạn chọn. Xem mục "Chờ bạn duyệt" ở trên cùng.` };
  const tasks = d.tasks.filter((t) => t.stage === current?.stage);
  const done = tasks.filter((t) => t.status === 'done').length;
  const rewriting = current?.stage === 'scripting' && d.approvals.some((a) => a.kind === 'choose_script' && a.status !== 'pending' && a.status !== 'approved');
  const progress = tasks.length ? ` (${done}/${tasks.length} việc xong)` : '';
  return {
    kind: 'wait',
    text: rewriting
      ? `Đội ngũ đang viết lại kịch bản theo góp ý của bạn${progress}. Bạn chưa cần làm gì, sẽ có thông báo khi xong.`
      : `Đội ngũ đang làm bước ${label}${progress}. Bạn chưa cần làm gì, sẽ có thông báo khi cần bạn chọn.`,
  };
}

/** Kịch bản người dùng đã duyệt (lần duyệt gần nhất). */
export function chosenScripts(d: CampaignDetail) {
  const approved = d.approvals.filter((a) => a.kind === 'choose_script' && a.status === 'approved').at(-1);
  const ids = ((approved?.decision as { chosen?: unknown } | null)?.chosen as string[] | undefined) ?? [];
  return ids.flatMap((id) => d.artifacts.filter((a) => a.id === id));
}

/** Báo cáo nghiên cứu tổng hợp mới nhất (nếu có). */
export function researchSummary(d: CampaignDetail) {
  return d.artifacts.filter((a) => a.kind === 'research_synthesis').at(-1);
}
