import { describe, expect, it } from 'vitest';
import { AGENT_ROLES, AGENT_STATES, STATE_BEHAVIOR, WORK_STATES, statesForRole } from './states.ts';

describe('STATE_BEHAVIOR', () => {
  it('có hành vi cho mọi trạng thái', () => {
    for (const s of AGENT_STATES) expect(STATE_BEHAVIOR[s]).toBeDefined();
  });

  it('Director chỉ có trạng thái ở bàn Director hoặc tại chỗ/họp', () => {
    for (const s of statesForRole('director')) {
      const kind = STATE_BEHAVIOR[s].placement.kind;
      expect(['director_desk', 'stay', 'zone', 'role_home']).toContain(kind);
      if (kind === 'zone' && s !== 'in_meeting') {
        expect(STATE_BEHAVIOR[s].placement).toEqual({ kind: 'zone', zone: 'general_workspace' });
      }
    }
  });

  it('mọi trạng thái làm việc của chuyên viên, assigned và offline đặt Agent tại bàn cố định (role_home)', () => {
    for (const r of AGENT_ROLES) {
      if (r === 'director' || r === 'coordinator') continue;
      for (const s of [...WORK_STATES[r], 'assigned', 'offline'] as const) expect(STATE_BEHAVIOR[s].placement, `${r}/${s}`).toEqual({ kind: 'role_home' });
    }
  });

  it('mỗi vai trò có ít nhất một trạng thái làm việc', () => {
    for (const r of AGENT_ROLES) expect(statesForRole(r).some((s) => STATE_BEHAVIOR[s].working)).toBe(true);
  });
});
