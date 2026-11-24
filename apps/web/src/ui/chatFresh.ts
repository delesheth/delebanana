// Tin nào vừa đến (để bong bóng có hiệu ứng xuất hiện): tin của Director chưa hiện lần nào trong khung này và mới tạo gần đây.
// Tin cũ nạp lúc mở khung/đổi chiến dịch không có hiệu ứng.

import type { MessageRow } from '@delebanana/domain';

export const FRESH_MS = 15_000;

export function freshIds(messages: Pick<MessageRow, 'id' | 'role' | 'createdAt'>[], shown: ReadonlySet<string>, now: number): Set<string> {
  return new Set(messages.filter((m) => m.role === 'agent' && !shown.has(m.id) && now - m.createdAt < FRESH_MS).map((m) => m.id));
}
