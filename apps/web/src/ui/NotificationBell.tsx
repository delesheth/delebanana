// Chuông thông báo góc trên bên phải: liệt kê việc vừa xong (ai làm, việc gì, kết quả). Có thông báo mới thì chuông xanh
// kèm chấm đỏ; mở bảng là đã xem.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { campaignStore } from '../campaign/instance.ts';
import { notices, setBellOpen } from '../notify/instance.ts';
import type { Notice } from '../notify/noticeStore.ts';
import { sidebars } from './sidebarStore.ts';

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(at).toLocaleDateString('vi-VN');
}

const KIND_MARK: Record<Notice['kind'], string> = { task_done: '✓', approval: '!', campaign_done: '★', system: 'ℹ' };

export function NotificationBell() {
  const { bellUnread, items } = useSyncExternalStore(notices.subscribe, notices.get);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBellOpen(open);
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  function openCampaign(n: Notice) {
    setOpen(false);
    if (!n.campaignId) return;
    campaignStore.select(n.campaignId);
    sidebars.open('left');
  }

  return (
    <div className="bell-wrap" ref={ref}>
      <button type="button" className={`bell ${bellUnread ? 'unread' : ''}`} onClick={() => setOpen(!open)} aria-label="Thông báo" aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M12 3a6 6 0 0 0-6 6v3.6l-1.6 2.7A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.7L18 12.6V9a6 6 0 0 0-6-6Z" fill="currentColor" />
          <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </svg>
        {bellUnread && <span className="unread-dot" />}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Thông báo">
          <header>
            <h2>Thông báo</h2>
            {items.length > 0 && (
              <button type="button" className="link" onClick={() => notices.clear()}>
                Xoá hết
              </button>
            )}
          </header>
          {items.length === 0 ? (
            <p className="hint empty">Chưa có thông báo. Khi đội ngũ làm xong việc gì, bạn sẽ thấy ở đây.</p>
          ) : (
            <ol>
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notice ${n.kind}`} onClick={() => openCampaign(n)}>
                    <span className="notice-mark">{KIND_MARK[n.kind]}</span>
                    <span className="notice-text">
                      <b>{n.title}</b>
                      {n.body && <span className="notice-body">{n.body}</span>}
                      <span className="hint">
                        {n.campaignTitle ? `${n.campaignTitle} · ` : ''}
                        {ago(n.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
