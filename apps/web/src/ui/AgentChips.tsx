// Nhãn "Tên · trạng thái" nổi trên đầu Director, Coordinator và nhân vật đang chọn.
// DOM phủ lên canvas, vị trí chiếu từ toạ độ 3D mỗi khung hình (không dùng <Html> của drei, xem ghi chú cũ ở Office).

import type { AgentState } from '@delebanana/domain';
import { useFrame } from '@react-three/fiber';
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { office } from '../sim/officeStore.ts';

export const STATE_TEXT: Record<AgentState, string> = {
  offline: 'Ngoại tuyến',
  idle: 'Rảnh',
  assigned: 'Nhận việc',
  researching: 'Nghiên cứu',
  brainstorming: 'Lên ý tưởng',
  writing: 'Viết kịch bản',
  generating_video: 'Dựng video',
  publishing: 'Đăng bài',
  analyzing: 'Phân tích',
  in_meeting: 'Họp',
  conversing: 'Trò chuyện',
  awaiting_user_reply: 'Chờ bạn trả lời',
  planning: 'Lập kế hoạch',
  reviewing: 'Duyệt',
  waiting_approval: 'Chờ phê duyệt',
  blocked_budget: 'Hết ngân sách',
  error: 'Lỗi',
};

/** Độ cao nhãn trên đầu nhân vật (m). */
const CHIP_Y = 2.55;
const elements = new Map<string, HTMLSpanElement>();
const v = new THREE.Vector3();

function chipIds(selectedId: string | null): string[] {
  const ids = office.runtimes.filter((rt) => rt.profile.role === 'director' || rt.profile.role === 'coordinator').map((rt) => rt.profile.id);
  if (selectedId && !ids.includes(selectedId)) ids.push(selectedId);
  return ids;
}

/** Đặt bên trong <Canvas>. */
export function AgentChipProjector() {
  useFrame(({ camera, size }) => {
    for (const [id, el] of elements) {
      const rt = office.runtime(id);
      if (!rt) continue;
      v.set(rt.mover.x, CHIP_Y, rt.mover.z).project(camera);
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      const text = `${rt.profile.name} · ${STATE_TEXT[office.stateOf(id)]}`;
      if (el.textContent !== text) el.textContent = text;
    }
  });
  return null;
}

/** Đặt bên ngoài <Canvas>, cùng khung chứa. */
export function AgentChips() {
  const { selectedId, lightsOn } = useSyncExternalStore(office.subscribeUi, office.getUi);
  if (!lightsOn) return null;
  return (
    <div className="agent-chips">
      {chipIds(selectedId).map((id) => (
        <span
          key={id}
          className={id === selectedId ? 'selected' : undefined}
          ref={(el) => {
            if (el) elements.set(id, el);
            else elements.delete(id);
          }}
        />
      ))}
    </div>
  );
}
