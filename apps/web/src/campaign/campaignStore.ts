// Store chat Director + danh sách/chi tiết Campaign, nằm ngoài React (đọc qua useSyncExternalStore).
// Chiến lược: sự kiện SSE chỉ báo "có thay đổi" → tải lại từ REST, không áp sự kiện cục bộ (sự kiện không đủ dữ liệu).

import type { CampaignDetail, CampaignRow, DomainEvent, MessageRow } from '@delebanana/domain';
import type { ApiClient, ImageUpload } from './api.ts';
import { createRefresher } from './refresher.ts';

export interface CampaignState {
  messages: MessageRow[];
  chatError: string | null;
  sending: boolean;
  campaigns: CampaignRow[];
  campaignError: string | null;
  creating: boolean;
  selectedId: string | null;
  detail: CampaignDetail | null;
  detailError: string | null;
}

export interface CampaignStore {
  subscribe(listener: () => void): () => void;
  get(): CampaignState;
  /** Nạp snapshot (kết nối hoặc nối lại SSE) → tải lại toàn bộ dữ liệu đang hiển thị. */
  onSnapshot(): void;
  onEvent(e: DomainEvent): void;
  /** Tải ảnh lên rồi gửi tin; trả `true` khi thành công. Không chữ, không ảnh → không gọi API; lỗi → `false` và đặt `chatError`. */
  send(content: string, images?: ImageUpload[]): Promise<boolean>;
  /** Tạo Campaign rồi chọn Campaign mới; trả id hoặc `null`. */
  create(title: string): Promise<string | null>;
  /** Xoá Campaign (đã hỏi người dùng trước); lỗi → `false` và đặt `campaignError`. */
  remove(id: string): Promise<boolean>;
  select(id: string | null): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createCampaignStore(api: ApiClient): CampaignStore {
  let state: CampaignState = {
    messages: [],
    chatError: null,
    sending: false,
    campaigns: [],
    campaignError: null,
    creating: false,
    selectedId: null,
    detail: null,
    detailError: null,
  };
  const listeners = new Set<() => void>();
  // Nguồn của chatError: tải lại nền chỉ xoá/ghi lỗi do chính nó đặt, không đụng lỗi gửi tin.
  let chatErrorOwner: 'send' | 'refresh' | null = null;
  function set(patch: Partial<CampaignState>) {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  }

  // Luồng chat đang xem = Campaign đang chọn; chưa chọn thì không có chat. Kết quả tải về muộn của luồng cũ bị bỏ.
  const messagesRefresher = createRefresher(async () => {
    const thread = state.selectedId;
    if (!thread) return;
    try {
      const messages = await api.listDirectorMessages(thread);
      if (state.selectedId !== thread) return;
      if (chatErrorOwner === 'refresh') {
        chatErrorOwner = null;
        set({ messages, chatError: null });
      } else set({ messages });
    } catch (e) {
      if (state.selectedId === thread && chatErrorOwner !== 'send') {
        chatErrorOwner = 'refresh';
        set({ chatError: message(e) });
      }
    }
  });

  const listRefresher = createRefresher(async () => {
    try {
      set({ campaigns: await api.listCampaigns(), campaignError: null });
    } catch (e) {
      set({ campaignError: message(e) });
    }
  });

  const detailRefresher = createRefresher(async () => {
    const id = state.selectedId;
    if (!id) return;
    try {
      const detail = await api.getCampaign(id);
      if (state.selectedId === id) set({ detail, detailError: null });
    } catch (e) {
      if (state.selectedId === id) set({ detailError: message(e) });
    }
  });

  return {
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => state,

    onSnapshot() {
      messagesRefresher.trigger();
      listRefresher.trigger();
      detailRefresher.trigger();
    },

    onEvent(e) {
      if (e.type === 'message.created') messagesRefresher.trigger();
      if (e.type === 'campaign.created' || e.type === 'campaign.status_changed' || e.type === 'campaign.deleted') listRefresher.trigger();
      if (e.type === 'campaign.deleted' && e.campaignId === state.selectedId) {
        this.select(null);
        return;
      }
      if (e.campaignId && e.campaignId === state.selectedId) detailRefresher.trigger();
    },

    async send(content, images = []) {
      const text = content.trim();
      const thread = state.selectedId;
      if (!thread || (!text && images.length === 0) || state.sending) return false;
      chatErrorOwner = null;
      set({ sending: true, chatError: null });
      try {
        const attachments = [];
        for (const img of images) attachments.push(await api.uploadImage(img));
        await api.sendDirectorMessage(text, thread, attachments);
      } catch (e) {
        chatErrorOwner = 'send';
        set({ sending: false, chatError: message(e) });
        return false;
      }
      set({ sending: false });
      messagesRefresher.trigger();
      return true;
    },

    async create(title) {
      const t = title.trim();
      if (!t || state.creating) return null;
      set({ creating: true, campaignError: null });
      try {
        const { id } = await api.createCampaign(t);
        set({ creating: false });
        listRefresher.trigger();
        this.select(id);
        return id;
      } catch (e) {
        set({ creating: false, campaignError: message(e) });
        return null;
      }
    },

    async remove(id) {
      set({ campaignError: null });
      try {
        await api.deleteCampaign(id);
      } catch (e) {
        set({ campaignError: message(e) });
        return false;
      }
      if (state.selectedId === id) this.select(null);
      set({ campaigns: state.campaigns.filter((c) => c.id !== id) });
      listRefresher.trigger();
      return true;
    },

    select(id) {
      if (id === state.selectedId) return;
      set({ selectedId: id, detail: null, detailError: null, messages: [] });
      messagesRefresher.trigger();
      if (id) detailRefresher.trigger();
    },
  };
}
