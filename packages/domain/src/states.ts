// Trạng thái Agent ở backend và cách văn phòng 3D hiển thị chúng.
// Nguồn: docs/product/boundaries.md mục 2. Backend là nguồn sự thật; 3D chỉ đọc.

export const AGENT_STATES = [
  'offline',
  'idle',
  'assigned',
  'researching',
  'brainstorming',
  'writing',
  'generating_video',
  'publishing',
  'analyzing',
  'in_meeting',
  'conversing',
  'awaiting_user_reply',
  'planning',
  'reviewing',
  'waiting_approval',
  'blocked_budget',
  'error',
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

// 6 khu cố định. Bàn Director và bàn Coordinator nằm trong General Workspace, không phải khu riêng.
export const ZONES = [
  'research',
  'creative',
  'scriptwriting',
  'video_studio',
  'meeting_room',
  'general_workspace',
] as const;
export type ZoneId = (typeof ZONES)[number];

export const AGENT_ROLES = [
  'director',
  'coordinator',
  'researcher',
  'creative',
  'scriptwriter',
  'video_producer',
  'publisher',
  'analyst',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Khu có bàn cố định của vai trò: mỗi Agent có một bàn riêng ở đây và làm mọi việc tại bàn đó. */
export const ROLE_HOME_ZONE: Record<AgentRole, ZoneId> = {
  director: 'general_workspace',
  coordinator: 'general_workspace',
  researcher: 'research',
  creative: 'creative',
  scriptwriter: 'scriptwriting',
  video_producer: 'video_studio',
  publisher: 'general_workspace',
  analyst: 'general_workspace',
};

/** Nơi nhân vật cần đứng khi ở một trạng thái. */
export type Placement =
  | { kind: 'zone'; zone: ZoneId }
  | { kind: 'role_home' }
  | { kind: 'director_desk' }
  | { kind: 'coordinator_desk' }
  /** Giữ nguyên chỗ hiện tại. */
  | { kind: 'stay' };

export type AnimationKind =
  | 'off'
  | 'idle'
  | 'receive'
  | 'typing'
  | 'reading'
  | 'whiteboard'
  | 'device'
  | 'charts'
  | 'meeting'
  | 'talking'
  | 'question'
  | 'cards'
  | 'waiting'
  | 'warning'
  | 'error';

/** Biểu tượng nổi trên đầu nhân vật. */
export type StatusIcon = 'none' | 'send' | 'question' | 'approval' | 'warning' | 'error' | 'speech';

export interface StateBehavior {
  placement: Placement;
  animation: AnimationKind;
  icon: StatusIcon;
  /** Trạng thái làm việc thật (được phép gõ phím, họp…). */
  working: boolean;
}

export const STATE_BEHAVIOR: Record<AgentState, StateBehavior> = {
  offline: { placement: { kind: 'role_home' }, animation: 'off', icon: 'none', working: false },
  idle: { placement: { kind: 'zone', zone: 'general_workspace' }, animation: 'idle', icon: 'none', working: false },
  assigned: { placement: { kind: 'role_home' }, animation: 'receive', icon: 'none', working: false },
  researching: { placement: { kind: 'role_home' }, animation: 'reading', icon: 'none', working: true },
  brainstorming: { placement: { kind: 'role_home' }, animation: 'whiteboard', icon: 'none', working: true },
  writing: { placement: { kind: 'role_home' }, animation: 'typing', icon: 'none', working: true },
  generating_video: { placement: { kind: 'role_home' }, animation: 'device', icon: 'none', working: true },
  publishing: { placement: { kind: 'role_home' }, animation: 'typing', icon: 'send', working: true },
  analyzing: { placement: { kind: 'role_home' }, animation: 'charts', icon: 'none', working: true },
  in_meeting: { placement: { kind: 'zone', zone: 'meeting_room' }, animation: 'meeting', icon: 'speech', working: true },
  conversing: { placement: { kind: 'director_desk' }, animation: 'talking', icon: 'speech', working: true },
  awaiting_user_reply: { placement: { kind: 'director_desk' }, animation: 'question', icon: 'question', working: false },
  planning: { placement: { kind: 'coordinator_desk' }, animation: 'cards', icon: 'none', working: true },
  reviewing: { placement: { kind: 'coordinator_desk' }, animation: 'reading', icon: 'none', working: true },
  waiting_approval: { placement: { kind: 'stay' }, animation: 'waiting', icon: 'approval', working: false },
  blocked_budget: { placement: { kind: 'stay' }, animation: 'warning', icon: 'warning', working: false },
  error: { placement: { kind: 'stay' }, animation: 'error', icon: 'error', working: false },
};

/** Trạng thái làm việc của từng vai trò (TK2 mục 5: ai viết prompt/caption cũng ở `writing`). */
export const WORK_STATES: Record<AgentRole, readonly AgentState[]> = {
  director: ['conversing'],
  coordinator: ['planning', 'reviewing'],
  researcher: ['researching'],
  creative: ['brainstorming', 'writing'],
  scriptwriter: ['writing'],
  video_producer: ['generating_video', 'writing'],
  publisher: ['publishing', 'writing'],
  analyst: ['analyzing'],
};

const COMMON_STATES: readonly AgentState[] = ['offline', 'idle', 'in_meeting', 'waiting_approval', 'blocked_budget', 'error'];

/** Trạng thái hợp lệ cho từng vai trò (Director không rời bàn, không nhận task; chỉ Coordinator `planning`/`reviewing`). */
export function statesForRole(role: AgentRole): readonly AgentState[] {
  return [
    ...COMMON_STATES,
    ...WORK_STATES[role],
    // Director không nhận task; Coordinator nhận task tự làm (planning, research.synthesis).
    ...(role === 'director' ? [] : (['assigned'] as const)),
    ...(role === 'director' ? (['awaiting_user_reply'] as const) : []),
  ];
}
