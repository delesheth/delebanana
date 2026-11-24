import { describe, expect, it } from 'vitest';
import { deriveAgentState, runState, type AgentFacts } from './deriveAgentState.ts';
import type { TaskKind } from './lifecycle/task.ts';
import { AGENT_ROLES, WORK_STATES, statesForRole, type AgentRole } from './states.ts';

const base: AgentFacts = {
  role: 'researcher',
  enabled: true,
  inMeeting: false,
  blocked: false,
  hasWaitingTask: false,
  hasAssignedTask: false,
  awaitingUserReply: false,
  hasPendingApproval: false,
  unseenFailure: false,
};
const f = (p: Partial<AgentFacts>): AgentFacts => ({ ...base, ...p });
const everything: Partial<AgentFacts> = {
  inMeeting: true,
  blocked: true,
  activeRun: { purpose: 'task', taskKind: 'research.trend' },
  hasWaitingTask: true,
  hasAssignedTask: true,
  hasPendingApproval: true,
  unseenFailure: true,
};

describe('deriveAgentState — thứ tự ưu tiên (TK2 mục 5)', () => {
  it('1. tắt → offline, thắng mọi thứ', () => expect(deriveAgentState(f({ ...everything, enabled: false }))).toBe('offline'));
  it('2. đang họp → in_meeting', () => expect(deriveAgentState(f(everything))).toBe('in_meeting'));
  it('3. bị chặn → blocked_budget', () => expect(deriveAgentState(f({ ...everything, inMeeting: false }))).toBe('blocked_budget'));
  it('4. lượt CLI đang chạy → theo loại task', () =>
    expect(deriveAgentState(f({ ...everything, inMeeting: false, blocked: false }))).toBe('researching'));
  it('5. task waiting → generating_video', () =>
    expect(deriveAgentState(f({ role: 'video_producer', hasWaitingTask: true, hasAssignedTask: true, hasPendingApproval: true }))).toBe(
      'generating_video',
    ));
  it('6. task assigned → assigned', () =>
    expect(deriveAgentState(f({ hasAssignedTask: true, hasPendingApproval: true, unseenFailure: true }))).toBe('assigned'));
  it('7. Director chờ trả lời → awaiting_user_reply', () =>
    expect(deriveAgentState(f({ role: 'director', awaitingUserReply: true, hasPendingApproval: true }))).toBe('awaiting_user_reply'));
  it('8. Approval chờ → waiting_approval', () =>
    expect(deriveAgentState(f({ hasPendingApproval: true, unseenFailure: true }))).toBe('waiting_approval'));
  it('9. lỗi chưa xem → error', () => expect(deriveAgentState(f({ unseenFailure: true }))).toBe('error'));
  it('10. còn lại → idle', () => expect(deriveAgentState(base)).toBe('idle'));
});

describe('chat của Agent chuyên môn không che trạng thái thấp hơn', () => {
  it('đang chờ video mà trả lời chat vẫn là generating_video', () => {
    expect(deriveAgentState(f({ role: 'video_producer', activeRun: { purpose: 'chat' }, hasWaitingTask: true }))).toBe('generating_video');
  });
  it('đang chat, có Approval chờ → waiting_approval', () => {
    expect(deriveAgentState(f({ activeRun: { purpose: 'chat' }, hasPendingApproval: true }))).toBe('waiting_approval');
  });
  it('chỉ đang chat → idle', () => {
    expect(deriveAgentState(f({ activeRun: { purpose: 'chat' } }))).toBe('idle');
  });
});

describe('task đang chạy nhưng lượt CLI chưa bắt đầu (S5)', () => {
  it('hiện trạng thái làm việc theo loại task, không phải idle', () => {
    expect(deriveAgentState(f({ runningTaskKind: 'research.trend' }))).toBe('researching');
    expect(deriveAgentState(f({ role: 'coordinator', runningTaskKind: 'research.synthesis' }))).toBe('planning');
  });
  it('lượt CLI đang chạy vẫn được ưu tiên hơn', () => {
    expect(deriveAgentState(f({ runningTaskKind: 'research.trend', activeRun: { purpose: 'chat' }, hasPendingApproval: true }))).toBe('researching');
  });
});

describe('Coordinator nhận task', () => {
  it('task assigned của Coordinator → assigned, thuộc statesForRole', () => {
    expect(deriveAgentState(f({ role: 'coordinator', hasAssignedTask: true }))).toBe('assigned');
    expect(statesForRole('coordinator')).toContain('assigned');
  });
});

describe('runState', () => {
  it('ánh xạ mục đích lượt chạy theo vai trò', () => {
    expect(runState('director', { purpose: 'chat' })).toBe('conversing');
    expect(runState('director', { purpose: 'briefing' })).toBe('conversing');
    expect(runState('coordinator', { purpose: 'review' })).toBe('reviewing');
    expect(runState('coordinator', { purpose: 'planning' })).toBe('planning');
    expect(runState('coordinator', { purpose: 'task', taskKind: 'research.synthesis' })).toBe('planning');
    expect(runState('creative', { purpose: 'task', taskKind: 'ideation' })).toBe('brainstorming');
    expect(runState('video_producer', { purpose: 'task', taskKind: 'video.prompt' })).toBe('writing');
    expect(runState('video_producer', { purpose: 'task', taskKind: 'video.template_render' })).toBe('generating_video');
    expect(runState('publisher', { purpose: 'task', taskKind: 'caption' })).toBe('writing');
    expect(runState('publisher', { purpose: 'task', taskKind: 'publish' })).toBe('publishing');
    expect(runState('analyst', { purpose: 'task', taskKind: 'analysis' })).toBe('analyzing');
    // Lượt suy ngẫm (TK4 mục 9).
    expect(runState('coordinator', { purpose: 'reflection' })).toBe('planning');
    expect(runState('analyst', { purpose: 'reflection' })).toBe('analyzing');
    expect(runState('scriptwriter', { purpose: 'reflection' })).toBe('writing');
  });
});

/** Loại task mỗi vai trò có thể nhận (dữ kiện hợp lệ cho vai trò). */
const ROLE_KINDS: Record<AgentRole, TaskKind[]> = {
  director: [],
  coordinator: ['planning', 'research.synthesis'],
  researcher: ['research.trend', 'research.competitor', 'research.audience'],
  creative: ['ideation', 'script'],
  scriptwriter: ['script'],
  video_producer: ['video.prompt', 'video.template_render'],
  publisher: ['caption', 'publish'],
  analyst: ['analysis'],
};

describe('bất biến: trạng thái suy ra luôn thuộc statesForRole', () => {
  it('với mọi dữ kiện hợp lệ của từng vai trò', () => {
    for (const role of AGENT_ROLES) {
      const runs: AgentFacts['activeRun'][] = [
        undefined,
        ...ROLE_KINDS[role].map((k) => ({ purpose: 'task' as const, taskKind: k })),
        ...(role === 'director' ? [{ purpose: 'chat' as const }, { purpose: 'briefing' as const }] : []),
        ...(role === 'coordinator' ? [{ purpose: 'planning' as const }, { purpose: 'review' as const }] : []),
      ];
      const flags = ['inMeeting', 'blocked', 'hasWaitingTask', 'hasAssignedTask', 'awaitingUserReply', 'hasPendingApproval', 'unseenFailure'] as const;
      for (const run of runs)
        for (const flag of [null, ...flags]) {
          if (flag === 'awaitingUserReply' && role !== 'director') continue;
          if (flag === 'hasWaitingTask' && role !== 'video_producer') continue;
          if (flag === 'hasAssignedTask' && role === 'director') continue;
          const facts = f({ role, activeRun: run, ...(flag ? { [flag]: true } : {}) });
          expect(statesForRole(role), `${role} ${JSON.stringify(run)} ${flag}`).toContain(deriveAgentState(facts));
        }
    }
  });

  it('WORK_STATES đúng theo vai trò', () => {
    expect(WORK_STATES.video_producer).toEqual(['generating_video', 'writing']);
    expect(statesForRole('publisher')).toContain('writing');
    expect(statesForRole('director')).toContain('awaiting_user_reply');
    expect(statesForRole('director')).not.toContain('assigned');
  });
});
