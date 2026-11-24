// Phân bổ Agent theo phòng (D-18, sửa 2026-11-23): mỗi phòng chuyên môn là phòng riêng của đúng một người; Publisher và
// Analyst ngồi chung General Workspace với trưởng phòng. Người thêm vào ngồi tạm General Workspace/module bàn (D-5/D-6).

import type { AgentRole } from './states.ts';

export type StaffRoom = 'research' | 'creative' | 'scriptwriting' | 'video_studio' | 'general_workspace' | 'director_office';

export const STAFFING: Record<StaffRoom, { default: number; max: number }> = {
  research: { default: 1, max: 1 },
  creative: { default: 1, max: 1 },
  scriptwriting: { default: 1, max: 1 },
  video_studio: { default: 1, max: 1 },
  general_workspace: { default: 3, max: 3 },
  director_office: { default: 1, max: 1 },
};

export function staffRoomOf(role: AgentRole): StaffRoom {
  switch (role) {
    case 'director':
      return 'director_office';
    case 'coordinator':
    case 'publisher':
    case 'analyst':
      return 'general_workspace';
    case 'researcher':
      return 'research';
    case 'creative':
      return 'creative';
    case 'scriptwriter':
      return 'scriptwriting';
    case 'video_producer':
      return 'video_studio';
  }
}

/** Đội mặc định theo thứ tự (mỗi phòng chuyên môn một người). Người thứ 9 trở đi ngồi tạm General Workspace/module bàn. */
export const STAFFING_ORDER: readonly AgentRole[] = ['director', 'coordinator', 'researcher', 'analyst', 'creative', 'scriptwriter', 'video_producer', 'publisher'];

export const DEFAULT_TEAM_SIZE = 8;
