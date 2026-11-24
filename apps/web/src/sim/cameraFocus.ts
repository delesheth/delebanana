// Yêu cầu đưa camera tới một khu (nút trên Dock) hoặc toàn cảnh. `seq` tăng mỗi lần bấm để bấm lại cùng phòng
// (sau khi người dùng đã kéo đi chỗ khác) vẫn bay về.

import type { RoomId } from '../office/plan.ts';

export type CameraFocus = 'all' | RoomId;

let state = { focus: 'all' as CameraFocus, seq: 0 };
const listeners = new Set<() => void>();

export const cameraFocus = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  set(focus: CameraFocus) {
    state = { focus, seq: state.seq + 1 };
    for (const l of [...listeners]) l();
  },
};
