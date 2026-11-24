import type { StatusIcon, ZoneId } from '@delebanana/domain';
import type { RoomId } from '../office/plan.ts';

/** Màu nhận diện khu (nhãn, vòng phòng ban). */
export const ZONE_COLORS: Record<ZoneId, string> = {
  research: '#5fa8d3',
  creative: '#ef7a95',
  scriptwriting: '#9b7fd1',
  video_studio: '#f2a541',
  meeting_room: '#4fb286',
  general_workspace: '#b8a990',
};

/** Sàn từng phòng, tông hiện đại: thảm xám lạnh, gỗ óc chó cho phòng Giám đốc, sàn tối cho phòng quay. */
export const ROOM_FLOORS: Record<Exclude<RoomId, `general:${number}`>, string> = {
  // Mỗi phòng một sàn theo cá tính: gỗ óc chó tối (học giả), gỗ trắng hồng (nữ tính), bê tông đen (hiphop), sồi sáng.
  research: '#5b4032',
  director: '#9c7657',
  scriptwriting: '#f3e4e6',
  creative: '#2c2d33',
  meeting_room: '#d7dce3',
  general_workspace: '#d9b98f',
  video_studio: '#4b4e54',
  lounge: '#6e5240',
};

/** Vỏ tòa nhà và nền cảnh: trắng ấm, điểm nhấn khung đen, kính xanh nhạt. */
export const BUILDING_COLORS = {
  background: '#e3e7ea',
  corridor: '#eceae5',
  wall: '#f6f5f1',
  slat: '#eceae4',
  trim: '#2b2e33',
  frame: '#2b2e33',
  glass: '#cfe4ee',
  window: '#b9d6e6',
  lamp: '#2b2e33',
  signBoard: '#1f2228',
  pool: '#ffb066',
} as const;

export const ICON_COLORS: Record<Exclude<StatusIcon, 'none'>, string> = {
  send: '#06d6a0',
  question: '#4d96ff',
  approval: '#ffd166',
  warning: '#f8961e',
  error: '#ef233c',
  speech: '#ffffff',
};
