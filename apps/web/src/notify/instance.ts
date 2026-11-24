// Store thông báo dùng chung: kênh "chat" = sidebar Director, "campaign" = sidebar Campaign, "bell" = bảng chuông.

import { createApiClient } from '../campaign/api.ts';
import { approvalStore } from '../sim/approvalStore.ts';
import { office } from '../sim/officeStore.ts';
import { sidebars } from '../ui/sidebarStore.ts';
import { createNoticeStore } from './noticeStore.ts';

let bellOpen = false;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const notices = createNoticeStore({
  api: createApiClient({ baseUrl: '/api' }),
  isOpen: (c) => (c === 'chat' ? sidebars.get().right : c === 'campaign' ? sidebars.get().left : bellOpen),
  nameOf: (id) => (id ? office.runtime(id)?.profile.name : undefined),
  storage: storage(),
});

export function setBellOpen(open: boolean) {
  bellOpen = open;
  if (open) notices.seen('bell');
}

// Mở sidebar = đã xem.
sidebars.subscribe(() => {
  const s = sidebars.get();
  if (s.right) notices.seen('chat');
  if (s.left) notices.seen('campaign');
});

// Có thêm việc chờ duyệt (kể cả lúc vừa mở trang) → nút Campaign báo.
let pending = 0;
approvalStore.subscribe(() => {
  const n = approvalStore.get().approvals.length;
  if (n > pending) notices.flagCampaign();
  pending = n;
});
