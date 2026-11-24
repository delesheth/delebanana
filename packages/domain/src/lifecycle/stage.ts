// Khung 5 bước cố định của Campaign — mục 4.2. Điều kiện bắt đầu/kết thúc bước (bước trước xong, mọi task xong,
// Approval đã duyệt) do backend kiểm khi gọi; máy chỉ giữ đường chuyển hợp lệ.

import { defineMachine } from '../machine.ts';
import type { ApprovalKind } from './approval.ts';

export type StageName = 'research' | 'scripting' | 'video' | 'publishing' | 'analytics';

export const STAGE_ORDER: readonly StageName[] = ['research', 'scripting', 'video', 'publishing', 'analytics'];

/** Điểm duyệt cuối bước; do backend đặt, không do LLM quyết. */
export const STAGE_GATE: Record<StageName, ApprovalKind | null> = {
  research: null,
  scripting: 'choose_script',
  video: 'approve_video',
  publishing: 'approve_publish',
  analytics: null,
};

export type StageStatus = 'pending' | 'running' | 'awaiting_approval' | 'done' | 'skipped';

export const stageMachine = defineMachine<StageStatus>({
  name: 'stage',
  states: ['pending', 'running', 'awaiting_approval', 'done', 'skipped'],
  terminal: ['done', 'skipped'],
  transitions: [
    { from: 'pending', to: 'running', by: ['system'] },
    { from: 'pending', to: 'skipped', by: ['system'] },
    { from: 'running', to: 'awaiting_approval', by: ['system'] },
    { from: 'running', to: 'done', by: ['system'] },
    { from: 'awaiting_approval', to: 'done', by: ['system'] },
    { from: 'awaiting_approval', to: 'running', by: ['system'] },
  ],
});
