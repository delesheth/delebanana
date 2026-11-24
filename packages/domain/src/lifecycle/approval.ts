// Vòng đời Approval — mục 4.6. Approval đã kết thúc không đổi nữa.

import { defineMachine } from '../machine.ts';

export const APPROVAL_KINDS = [
  'choose_script',
  'make_video',
  'approve_video',
  'approve_publish',
  // Đổi brief/chiến lược khi Campaign đã chạy (TK3 mục 6).
  'strategy_change',
  'out_of_permission',
  'limit_override',
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'expired';

export const approvalMachine = defineMachine<ApprovalStatus>({
  name: 'approval',
  states: ['pending', 'approved', 'rejected', 'changes_requested', 'expired'],
  terminal: ['approved', 'rejected', 'changes_requested', 'expired'],
  transitions: [
    { from: 'pending', to: 'approved', by: ['user'] },
    { from: 'pending', to: 'rejected', by: ['user'] },
    { from: 'pending', to: 'changes_requested', by: ['user'] },
    { from: 'pending', to: 'expired', by: ['system'] },
  ],
});
