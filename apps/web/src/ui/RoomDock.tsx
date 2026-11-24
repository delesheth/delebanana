// Dock kiểu macOS ở giữa đáy màn hình: mỗi nút bay camera tới một phòng ban; nút cuối xem toàn văn phòng.

import { useSyncExternalStore } from 'react';
import { roomById, type RoomId } from '../office/plan.ts';
import { cameraFocus, type CameraFocus } from '../sim/cameraFocus.ts';
import { sidebars } from './sidebarStore.ts';

/** Tên nút = tên phòng in trên biển trong văn phòng; icon = món đặc trưng của phòng. */
const ITEMS: { id: RoomId; icon: string }[] = [
  { id: 'director', icon: '💼' },
  { id: 'research', icon: '📚' },
  { id: 'scriptwriting', icon: '💗' },
  { id: 'creative', icon: '🎧' },
  { id: 'meeting_room', icon: '🤝' },
  { id: 'general_workspace', icon: '🖥️' },
  { id: 'video_studio', icon: '🎥' },
  { id: 'lounge', icon: '🍸' },
];

function DockButton({ focus, label, icon, active }: { focus: CameraFocus; label: string; icon: string; active: boolean }) {
  // Full Office: đóng cả các tab đang mở để nhìn trọn văn phòng. Bấm lại nút phòng đang xem: quay ra toàn văn phòng.
  const go = () => (focus === 'all' ? sidebars.closeAll() : cameraFocus.set(active ? 'all' : focus));
  return (
    <button type="button" className={`dock-item ${active ? 'active' : ''}`} onClick={go} aria-label={label} aria-pressed={active}>
      <span className="dock-icon" aria-hidden>
        {icon}
      </span>
      <span className="dock-tip" role="tooltip">
        {label}
      </span>
    </button>
  );
}

export function RoomDock() {
  const { focus } = useSyncExternalStore(cameraFocus.subscribe, cameraFocus.get);
  return (
    <nav className="room-dock" aria-label="Phòng ban">
      {ITEMS.map((it) => (
        <DockButton key={it.id} focus={it.id} label={roomById(it.id).label} icon={it.icon} active={focus === it.id} />
      ))}
      <span className="dock-divider" aria-hidden />
      <DockButton focus="all" label="Full Office" icon="⛶" active={focus === 'all'} />
    </nav>
  );
}
