// Thông báo cho người dùng từ kênh sự kiện: chấm đỏ trên nút chat Director (tin mới), nút Campaign (cần duyệt / đổi trạng
// thái) và chuông (danh sách việc vừa xong kèm mô tả). Danh sách chuông lưu trong trình duyệt để tải lại trang không mất.

import type { DomainEvent } from '@delebanana/domain';
import type { ApiClient } from '../campaign/api.ts';
import { artifactTitle } from '../ui/markdown.tsx';
import { ROLE_LABEL } from '../ui/labels.ts';

export type NoticeKind = 'task_done' | 'approval' | 'campaign_done' | 'system';

export interface Notice {
  id: string;
  at: number;
  kind: NoticeKind;
  title: string;
  body?: string;
  campaignId?: string;
  campaignTitle?: string;
}

export interface NoticeState {
  chatUnread: boolean;
  campaignUnread: boolean;
  bellUnread: boolean;
  items: Notice[];
}

export type Channel = 'chat' | 'campaign' | 'bell';

export interface NoticeDeps {
  api: Pick<ApiClient, 'getCampaign' | 'listSystemNotices'>;
  /** Kênh đang mở (người dùng đang nhìn) thì không cần chấm đỏ. */
  isOpen(channel: Channel): boolean;
  nameOf(agentId: string | null | undefined): string | undefined;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

const KEY = 'dele.notices.v1';
const MAX_ITEMS = 50;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function createNoticeStore(deps: NoticeDeps) {
  /** Mốc tin hệ thống mới nhất đã vào chuông (kể cả đã xoá): tin cũ hơn không nạp lại từ snapshot. */
  let systemSeenAt = 0;
  let state: NoticeState = { chatUnread: false, campaignUnread: false, bellUnread: false, items: [] };
  try {
    const saved = JSON.parse(deps.storage?.getItem(KEY) ?? 'null') as (Partial<NoticeState> & { systemSeenAt?: unknown }) | null;
    if (saved && Array.isArray(saved.items)) state = { ...state, items: saved.items.slice(0, MAX_ITEMS), bellUnread: !!saved.bellUnread };
    if (typeof saved?.systemSeenAt === 'number') systemSeenAt = saved.systemSeenAt;
  } catch {
    // dữ liệu hỏng hoặc không có quyền đọc: bắt đầu rỗng
  }
  const listeners = new Set<() => void>();
  function set(patch: Partial<NoticeState>) {
    state = { ...state, ...patch };
    try {
      deps.storage?.setItem(KEY, JSON.stringify({ items: state.items, bellUnread: state.bellUnread, systemSeenAt }));
    } catch {
      // trình duyệt chặn lưu: vẫn chạy bình thường trong phiên
    }
    for (const l of [...listeners]) l();
  }
  function push(n: Notice) {
    if (n.kind === 'system') systemSeenAt = Math.max(systemSeenAt, n.at);
    if (state.items.some((x) => x.id === n.id)) return;
    set({ items: [n, ...state.items].slice(0, MAX_ITEMS), bellUnread: !deps.isOpen('bell') });
  }

  async function taskDone(e: DomainEvent<'task.status_changed'>) {
    if (!e.campaignId) return;
    try {
      const d = await deps.api.getCampaign(e.campaignId);
      const t = d.tasks.find((x) => x.id === e.entity.id);
      if (!t) return;
      const input = t.input as { title?: unknown; instructions?: unknown };
      const who = deps.nameOf(t.assigneeAgentId ?? e.data.assigneeAgentId) ?? ROLE_LABEL[t.requiredRole] ?? t.requiredRole;
      const result = d.artifacts.filter((a) => a.taskId === t.id).at(-1);
      const parts = [
        typeof input.instructions === 'string' ? clip(input.instructions, 220) : '',
        result ? `Kết quả: ${artifactTitle(result.content, '')}` : '',
      ].filter(Boolean);
      push({
        id: `task:${t.id}:${t.attempt}`,
        at: e.at,
        kind: 'task_done',
        title: `${who} đã xong: ${typeof input.title === 'string' ? input.title : t.kind}`,
        body: parts.join('\n'),
        campaignId: d.campaign.id,
        campaignTitle: d.campaign.title,
      });
    } catch {
      // không tải được chi tiết: bỏ qua thông báo này
    }
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => state,
    /** Nạp (mở trang/nối lại) tin hệ thống đã tạo lúc web không mở: id `system:<id tin>` trùng với tin đến qua sự kiện trực tiếp. */
    onSnapshot() {
      void (async () => {
        try {
          const rows = await deps.api.listSystemNotices();
          const fresh = rows.filter((r) => r.createdAt > systemSeenAt && !state.items.some((x) => x.id === `system:${r.id}`));
          if (fresh.length === 0) return;
          systemSeenAt = Math.max(systemSeenAt, ...fresh.map((r) => r.createdAt));
          const added = fresh.map((r): Notice => ({ id: `system:${r.id}`, at: r.createdAt, kind: 'system', title: 'Thông báo hệ thống', body: r.content }));
          const items = [...added, ...state.items].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
          set({ items, bellUnread: state.bellUnread || !deps.isOpen('bell') });
        } catch {
          // không tải được: bỏ qua, lần nối lại sau sẽ thử lại
        }
      })();
    },
    onEvent(e: DomainEvent) {
      switch (e.type) {
        case 'message.created': {
          const d = e.data as { role?: string; text?: string };
          // Tin hệ thống không gắn chiến dịch (hạn mức gói/provider) không có luồng chat: hiện qua chuông.
          if (d.role === 'system' && !e.campaignId) {
            if (d.text) push({ id: `system:${e.entity.id}`, at: e.at, kind: 'system', title: 'Thông báo hệ thống', body: d.text });
            return;
          }
          if (d.role !== 'user' && e.campaignId && !deps.isOpen('chat')) set({ chatUnread: true });
          return;
        }
        case 'approval.requested':
          if (!deps.isOpen('campaign')) set({ campaignUnread: true });
          push({ id: `approval:${e.entity.id}`, at: e.at, kind: 'approval', title: 'Có việc cần bạn duyệt', body: 'Đội ngũ đã xong một bước và đang chờ bạn chọn. Mở Campaign để xem.', campaignId: e.campaignId });
          return;
        case 'campaign.status_changed': {
          const to = (e.data as { to?: string }).to;
          if (!deps.isOpen('campaign')) set({ campaignUnread: true });
          if (to === 'completed') push({ id: `done:${e.entity.id}`, at: e.at, kind: 'campaign_done', title: 'Chiến dịch đã hoàn thành 🎉', body: 'Mở Campaign để xem kịch bản đã chọn.', campaignId: e.campaignId });
          return;
        }
        case 'task.status_changed':
          if ((e.data as { to?: string }).to === 'done') void taskDone(e as DomainEvent<'task.status_changed'>);
          return;
        default:
          return;
      }
    },
    /** Người dùng đã mở kênh: bỏ chấm đỏ. */
    seen(channel: Channel) {
      if (channel === 'chat' && state.chatUnread) set({ chatUnread: false });
      if (channel === 'campaign' && state.campaignUnread) set({ campaignUnread: false });
      if (channel === 'bell' && state.bellUnread) set({ bellUnread: false });
    },
    /** Có việc chờ duyệt lúc mở trang: nút Campaign báo luôn. */
    flagCampaign() {
      if (!deps.isOpen('campaign') && !state.campaignUnread) set({ campaignUnread: true });
    },
    clear: () => set({ items: [], bellUnread: false }),
  };
}

export type NoticeStore = ReturnType<typeof createNoticeStore>;
