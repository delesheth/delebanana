// Client REST cho luồng Campaign. `fetch` được tiêm để kiểm thử trong node; lỗi HTTP ném Error kèm `error` từ body.

import type { CampaignDetail, CampaignRow, MessageAttachment, MessageRow, MetaAppStatus, PostRow, SocialAccountRow, TaskInfo } from '@delebanana/domain';

export interface ApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<ApiResponse>;

export interface SystemNotice {
  id: string;
  content: string;
  createdAt: number;
}

export interface ApiClient {
  listCampaigns(): Promise<CampaignRow[]>;
  createCampaign(title: string): Promise<{ id: string }>;
  deleteCampaign(id: string): Promise<void>;
  getCampaign(id: string): Promise<CampaignDetail>;
  getTask(id: string): Promise<TaskInfo>;
  /** Tin của luồng chat Director của một chiến dịch (chỉ chat trong chiến dịch). */
  listDirectorMessages(campaignId: string): Promise<MessageRow[]>;
  sendDirectorMessage(content: string, campaignId: string, attachments?: MessageAttachment[]): Promise<{ id: string }>;
  /** `data` là nội dung ảnh dạng base64 (không có tiền tố `data:`). */
  uploadImage(image: ImageUpload): Promise<MessageAttachment>;
  // ---- Đăng bài (phiếu D) ----
  getPublishAccounts(): Promise<PublishAccountsView>;
  saveFacebookApp(appId: string, appSecret: string): Promise<MetaAppStatus>;
  connectFacebookToken(token: string): Promise<SocialAccountRow>;
  selectFacebookPage(selectionId: string, pageId: string): Promise<SocialAccountRow>;
  disconnectAccount(id: string): Promise<void>;
  listPosts(campaignId: string): Promise<PostRow[]>;
  /** Tin hệ thống không gắn chiến dịch gần đây (mới nhất trước) để nạp vào chuông. */
  listSystemNotices(limit?: number): Promise<SystemNotice[]>;
  /** `when`: đổi giờ đăng (đăng ngay / giờ hẹn mới) trước khi thử lại. */
  retryPost(id: string, when?: { mode: 'now' } | { mode: 'schedule'; at: number }): Promise<void>;
  /** Đăng tay: người dùng đã tự đăng; `link` (http/https) tuỳ chọn. */
  markPostPublished(id: string, link?: string): Promise<void>;
  cancelPost(id: string): Promise<void>;
}

/** `GET /publish/accounts`: tài khoản đã kết nối, Page đang chờ chọn sau OAuth và cấu hình app Meta (không có token/secret). */
export interface PublishAccountsView {
  accounts: SocialAccountRow[];
  pending: { selectionId: string; pages: { id: string; name: string }[] }[];
  app: MetaAppStatus;
}

export interface ImageUpload {
  name: string;
  mime: string;
  data: string;
}

/** Số tin gần nhất tải về (tối đa server cho phép) để bảng chat mở rộng xem được cả tin cũ. */
const HISTORY_LIMIT = 200;

export function createApiClient(opts: { baseUrl: string; fetch?: FetchLike }): ApiClient {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));

  async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', payload?: unknown): Promise<T> {
    const init = method !== 'GET' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) } : { method };
    const res = await doFetch(`${opts.baseUrl}${path}`, init);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const msg = (data as { error?: unknown } | undefined)?.error;
      throw new Error(typeof msg === 'string' ? msg : `Lỗi HTTP ${res.status}`);
    }
    return data as T;
  }

  return {
    listCampaigns: () => call('/campaigns'),
    createCampaign: (title) => call('/campaigns', 'POST', { title }),
    getCampaign: (id) => call(`/campaigns/${encodeURIComponent(id)}`),
    getTask: (id) => call(`/tasks/${encodeURIComponent(id)}`),
    deleteCampaign: async (id) => {
      await call(`/campaigns/${encodeURIComponent(id)}`, 'DELETE');
    },
    listDirectorMessages: (campaignId) =>
      call(`/conversations/director/messages?limit=${HISTORY_LIMIT}&campaignId=${encodeURIComponent(campaignId)}`),
    sendDirectorMessage: (content, campaignId, attachments) =>
      call('/conversations/director/messages', 'POST', { content, campaignId, ...(attachments?.length ? { attachments } : {}) }),
    uploadImage: (image) => call('/uploads', 'POST', image),
    getPublishAccounts: () => call('/publish/accounts'),
    saveFacebookApp: (appId, appSecret) => call('/publish/facebook/app', 'PUT', { appId, appSecret }),
    connectFacebookToken: (token) => call('/publish/facebook/token', 'POST', { token }),
    selectFacebookPage: (selectionId, pageId) => call('/publish/facebook/pages/select', 'POST', { selectionId, pageId }),
    disconnectAccount: async (id) => {
      await call(`/publish/accounts/${encodeURIComponent(id)}`, 'DELETE');
    },
    listSystemNotices: (limit = 20) => call(`/notices/system?limit=${limit}`),
    listPosts: (campaignId) => call(`/campaigns/${encodeURIComponent(campaignId)}/posts`),
    retryPost: async (id, when) => {
      await call(`/posts/${encodeURIComponent(id)}/retry`, 'POST', when ? { when } : undefined);
    },
    markPostPublished: async (id, link) => {
      await call(`/posts/${encodeURIComponent(id)}/mark-published`, 'POST', link?.trim() ? { link: link.trim() } : {});
    },
    cancelPost: async (id) => {
      await call(`/posts/${encodeURIComponent(id)}/cancel`, 'POST');
    },
  };
}
