// Roster giả chỉ dùng trong kiểm thử (bố cục, chỗ ngồi); app chạy thật lấy roster từ server qua /snapshot.

import { STAFFING_ORDER, type AgentRole } from '@delebanana/domain';
import { appearanceFor } from './appearance.ts';
import type { AgentProfile } from './roster.ts';

const SPECIALISTS: AgentRole[] = ['researcher', 'creative', 'scriptwriter', 'video_producer', 'publisher', 'analyst'];
const NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khánh', 'Linh', 'Minh', 'Nam', 'Ngọc', 'Phúc', 'Quân', 'Sơn', 'Thảo', 'Trang', 'Tú', 'Vy'];

export function createRoster(count: number): AgentProfile[] {
  return Array.from({ length: count }, (_, i) => {
    // D-18: vai trò theo STAFFING_ORDER; vượt 15 thì xoay vòng chuyên môn (Agent dư ngồi tạm General Workspace, D-5/D-6).
    const role: AgentRole = STAFFING_ORDER[i] ?? SPECIALISTS[(i - STAFFING_ORDER.length) % SPECIALISTS.length]!;
    const base = NAMES[i % NAMES.length]!;
    const name = i < NAMES.length ? base : `${base} ${Math.floor(i / NAMES.length) + 1}`;
    return { id: `agent-${i}`, name, role, appearance: appearanceFor(i) };
  });
}
