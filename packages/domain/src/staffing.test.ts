import { describe, expect, it } from 'vitest';
import { AGENT_ROLES } from './states.ts';
import { DEFAULT_TEAM_SIZE, STAFFING, STAFFING_ORDER, staffRoomOf, type StaffRoom } from './staffing.ts';

function perRoom(n: number) {
  const out = {} as Record<StaffRoom, number>;
  for (const k of Object.keys(STAFFING) as StaffRoom[]) out[k] = 0;
  for (const role of STAFFING_ORDER.slice(0, n)) out[staffRoomOf(role)]++;
  return out;
}

describe('STAFFING_ORDER (D-18)', () => {
  it('đội mặc định 8 người, mỗi phòng chuyên môn một người', () => {
    expect(STAFFING_ORDER).toHaveLength(DEFAULT_TEAM_SIZE);
    expect(STAFFING_ORDER).toEqual([
      'director', 'coordinator', 'researcher', 'analyst', 'creative', 'scriptwriter', 'video_producer', 'publisher',
    ]);
    for (const r of STAFFING_ORDER) expect(AGENT_ROLES).toContain(r);
  });

  it('đội mặc định đúng mức mặc định mỗi phòng', () => {
    const c = perRoom(DEFAULT_TEAM_SIZE);
    for (const k of Object.keys(STAFFING) as StaffRoom[]) expect(c[k], k).toBe(STAFFING[k].default);
  });

  it('Publisher và Analyst ngồi chung General Workspace với trưởng phòng', () => {
    expect(staffRoomOf('publisher')).toBe('general_workspace');
    expect(staffRoomOf('analyst')).toBe('general_workspace');
    expect(perRoom(DEFAULT_TEAM_SIZE).general_workspace).toBe(3);
  });
});
