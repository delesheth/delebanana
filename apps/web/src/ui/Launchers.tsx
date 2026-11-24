// Nút nhỏ ở hai góc đáy màn hình để mở sidebar Campaign (trái) và chat Director (phải); ẩn khi sidebar đang mở.
// Mặc định trắng; có tin/thông báo mới thì xanh kèm chấm đỏ.

import { useSyncExternalStore } from 'react';
import { notices } from '../notify/instance.ts';
import { office } from '../sim/officeStore.ts';
import { sidebars } from './sidebarStore.ts';

export function Launchers() {
  const open = useSyncExternalStore(sidebars.subscribe, sidebars.get);
  const { chatUnread, campaignUnread } = useSyncExternalStore(notices.subscribe, notices.get);
  useSyncExternalStore(office.subscribeUi, office.getUi);
  const director = office.runtimes.find((rt) => rt.profile.role === 'director')?.profile.name ?? 'Director';
  return (
    <>
      {!open.left && (
        <button type="button" className={`launcher left ${campaignUnread ? 'unread' : ''}`} onClick={() => sidebars.open('left')}>
          Campaign
          {campaignUnread && <span className="unread-dot" aria-label="có thông báo mới" />}
        </button>
      )}
      {!open.right && (
        <button type="button" className={`launcher right ${chatUnread ? 'unread' : ''}`} onClick={() => sidebars.open('right')}>
          Chat với {director}
          {chatUnread && <span className="unread-dot" aria-label="có tin nhắn mới" />}
        </button>
      )}
    </>
  );
}
