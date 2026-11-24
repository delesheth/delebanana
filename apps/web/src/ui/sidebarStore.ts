// Hai sidebar (Campaign bên trái, Director bên phải): đóng, hoặc mở với độ rộng cố định 1/3 màn hình.
// Mở bằng nút nhỏ ở đáy màn hình; mở chat Director thì camera bay tới Director Office, đóng thì lùi về toàn văn phòng.

import { cameraFocus } from '../sim/cameraFocus.ts';

export type SidebarSide = 'left' | 'right';

let state: Record<SidebarSide, boolean> = { left: false, right: false };
const listeners = new Set<() => void>();
function set(side: SidebarSide, open: boolean) {
  if (state[side] === open) return;
  state = { ...state, [side]: open };
  for (const l of [...listeners]) l();
}

export const sidebars = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  open(side: SidebarSide) {
    set(side, true);
    if (side === 'right') cameraFocus.set('director');
  },
  /** Nút Full Office: đóng mọi tab, camera lùi về toàn văn phòng. */
  closeAll() {
    if (state.left || state.right) {
      state = { left: false, right: false };
      for (const l of [...listeners]) l();
    }
    cameraFocus.set('all');
  },
  /** Đóng (nút ✕) → camera lùi về toàn văn phòng. */
  close(side: SidebarSide) {
    if (!state[side]) return;
    set(side, false);
    cameraFocus.set('all');
  },
};
