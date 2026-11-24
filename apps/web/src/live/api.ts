// Client HTTP cho các thao tác duyệt Approval và mở khoá provider. Thuần TS, `fetch` tiêm được để kiểm thử trong node.
// Mọi POST gửi `Content-Type: application/json` (bộ chặn CSRF của server từ chối nếu thiếu); riêng tải video gửi thân thô `video/*`.

import type { LatestVideo, PostRow } from '@delebanana/domain';

export type DecideStatus = 'approved' | 'rejected' | 'changes_requested';

/** Hình dạng JSON của một dòng `approvals` trên server. */
export interface ApprovalRow {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  kind: string;
  subject: Record<string, unknown>;
  requestedByAgentId: string | null;
  status: string;
  decision: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  /** Approval chọn artifact (vd. chọn kịch bản): nội dung các artifact đề xuất, theo thứ tự trong `subject.ids`. */
  artifacts?: { id: string; kind: string; content: unknown }[];
  /** `choose_script`: bước video của chiến dịch còn dùng được (nút "Tạo video"). Thiếu = server cũ, coi như dùng được. */
  videoAvailable?: boolean;
  /** `make_video`/`approve_video`: phiên bản video mới nhất (trạng thái, lý do invalid). */
  latestVideo?: LatestVideo | null;
  /** `approve_publish`: bài đăng của yêu cầu (caption nháp từng nền tảng) và điều kiện đăng Facebook. */
  posts?: PostRow[];
  /** `approve_publish`: video đã duyệt để xem lại trước khi đăng. */
  video?: { id: string; number: number; mime: string | null; sizeBytes: number | null } | null;
  facebookReady?: boolean;
  reelsSpecReasons?: string[];
  /** `approve_publish`: tài khoản Instagram dùng được (vd. `@shop`) → bài Instagram tự đăng qua API; null/thiếu = đăng tay. */
  instagramAccount?: string | null;
  instagramSpecReasons?: string[];
}

/** Kết quả `POST /videos/:id/upload`: `invalid` kèm lý do cụ thể, cho tải lại. */
export interface VideoUploadResult {
  versionId: string;
  number: number;
  status: 'ready' | 'invalid';
  reasons: string[];
}

/** Hình dạng JSON của một phần tử `GET /providers`. */
export interface ProviderStatusRow {
  provider: string;
  blockedUntil: number | null;
  blockReason: string | null;
  utilization5h: number | null;
  utilization7d: number | null;
  resetsAt: number | null;
}

/** Lỗi do server trả (kèm `error` trong JSON) hoặc phản hồi không đọc được. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Blob }) => Promise<FetchResponse>;

export interface ApiOptions {
  /** Tiền tố URL của server, ví dụ `/api`. */
  baseUrl: string;
  fetch?: FetchLike;
}

export interface Api {
  pendingApprovals(): Promise<ApprovalRow[]>;
  decide(id: string, status: DecideStatus, decision?: Record<string, unknown>): Promise<void>;
  providers(): Promise<ProviderStatusRow[]>;
  unblock(provider: string): Promise<void>;
  uploadVideo(makeVideoApprovalId: string, file: Blob): Promise<VideoUploadResult>;
}

export function createApi(opts: ApiOptions): Api {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));

  async function call(path: string, init?: { method: string; body: unknown }): Promise<unknown> {
    return send(path, init ? { method: init.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : { method: 'GET' });
  }

  async function send(path: string, init: Parameters<FetchLike>[1]): Promise<unknown> {
    let res: FetchResponse;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, init);
    } catch {
      throw new ApiError('Không kết nối được server', 0);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const msg = (json as { error?: unknown } | undefined)?.error;
      throw new ApiError(typeof msg === 'string' ? msg : `Server trả lỗi ${res.status}`, res.status);
    }
    return json;
  }

  const list = async <T>(path: string): Promise<T[]> => {
    const json = await call(path);
    if (!Array.isArray(json)) throw new ApiError('Phản hồi sai định dạng', 200);
    return json as T[];
  };

  return {
    pendingApprovals: () => list<ApprovalRow>('/approvals?status=pending'),
    decide: async (id, status, decision = {}) => {
      await call(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: { status, decision } });
    },
    providers: () => list<ProviderStatusRow>('/providers'),
    unblock: async (provider) => {
      await call(`/providers/${encodeURIComponent(provider)}/unblock`, { method: 'POST', body: {} });
    },
    uploadVideo: async (makeVideoApprovalId, file) =>
      (await send(`/videos/${encodeURIComponent(makeVideoApprovalId)}/upload`, { method: 'POST', headers: { 'Content-Type': (file as File).type }, body: file })) as VideoUploadResult,
  };
}
