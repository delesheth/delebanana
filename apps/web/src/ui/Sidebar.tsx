// Khung sidebar dùng chung cho Campaign (trái) và Director (phải): rộng cố định 1/3 màn hình, nút × để đóng.

import type { ReactNode } from 'react';
import { sidebars, type SidebarSide } from './sidebarStore.ts';

interface Props {
  side: SidebarSide;
  title: string;
  icon?: ReactNode;
  /** Phụ đề / trạng thái dưới tiêu đề. */
  meta?: ReactNode;
  children: ReactNode;
}

export function Sidebar({ side, title, icon, meta, children }: Props) {
  return (
    <aside className={`sidebar ${side}`} aria-label={title}>
      <header className="sidebar-header">
        {icon && <span className="sidebar-icon">{icon}</span>}
        <div className="sidebar-title">
          <h2>{title}</h2>
          {meta}
        </div>
        <button type="button" className="icon-btn" onClick={() => sidebars.close(side)} aria-label={`Đóng ${title}`} title="Đóng">
          ✕
        </button>
      </header>
      <div className="sidebar-body">{children}</div>
    </aside>
  );
}
