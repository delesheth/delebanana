// Lớp gọi Meta (Graph API + rupload) bằng `fetch` tiêm được (D-14: không SDK, không dịch vụ trả phí). Mọi lời gọi mạng tới
// Meta đi qua đây để kiểm thử thay bằng bản giả. Token chỉ đi qua tham số/header, không bao giờ vào thông báo lỗi hay log.

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

// ---- Hằng số Meta (Cần kiểm chứng với tài liệu Meta hiện hành; gom một chỗ để sửa nhanh khi Meta đổi) ----
export const GRAPH_VERSION = 'v23.0';
export const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const RUPLOAD_URL = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
/** Upload resumable cho container Reels của Instagram (không cần URL công khai; chỉ cho app dùng Facebook Login). Cần kiểm chứng. */
export const IG_RUPLOAD_URL = `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}`;
export const OAUTH_DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
/** Quyền cần để đăng Reels lên Page và lên tài khoản Instagram liên kết với Page (docs/product/platform-limits.md). */
export const FB_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'] as const;
/** Mã lỗi Graph coi là tạm thời (thử lại được): 1, 2 lỗi chung; 4, 17, 32, 341, 368, 613 giới hạn tốc độ. Cần kiểm chứng. */
export const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);
/** Mã 190: token hết hạn/bị thu hồi. */
export const TOKEN_EXPIRED_CODE = 190;
/** Gửi cờ nội dung do AI tạo ở bước finish (platform-limits.md nêu cờ `is_ai_generated` của Reels; vị trí tham số Cần kiểm chứng khi chạy thật). Video của dự án do AI tạo. */
export const SEND_AI_FLAG = true;
export const AI_FLAG_PARAM = 'is_ai_generated';

export class MetaError extends Error {
  readonly transient: boolean;
  readonly code?: number;
  readonly tokenExpired: boolean;
  constructor(message: string, o: { transient: boolean; code?: number; tokenExpired?: boolean }) {
    super(message);
    this.transient = o.transient;
    this.code = o.code;
    this.tokenExpired = o.tokenExpired ?? false;
  }
}

export interface MetaApp {
  appId: string;
  appSecret: string;
}
export interface TokenInfo {
  accessToken: string;
  /** Giây còn lại tới khi hết hạn; thiếu = không báo. */
  expiresIn?: number;
}
export interface PageInfo {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}
export interface DebugInfo {
  isValid: boolean;
  /** ms epoch; null = không hết hạn. */
  expiresAt: number | null;
  dataAccessExpiresAt: number | null;
  scopes: string[];
}
export interface ReelStatus {
  phase: 'uploading' | 'processing' | 'scheduled' | 'published' | 'error';
  permalink?: string;
  error?: string;
}
export interface FinishInput {
  videoId: string;
  state: 'PUBLISHED' | 'SCHEDULED';
  description: string;
  /** UNIX giây, chỉ khi SCHEDULED. */
  scheduledPublishTime?: number;
  aiGenerated?: boolean;
}
/** `status_code` của container Instagram. */
export type IgContainerCode = 'IN_PROGRESS' | 'FINISHED' | 'PUBLISHED' | 'ERROR' | 'EXPIRED';
export interface IgContainerStatus {
  status: IgContainerCode;
  error?: string;
}

export interface MetaClient {
  exchangeCode(app: MetaApp, code: string, redirectUri: string): Promise<TokenInfo>;
  exchangeLongLived(app: MetaApp, userToken: string): Promise<TokenInfo>;
  listPages(userToken: string): Promise<PageInfo[]>;
  /** Kiểm token Page dán tay: trả Page mà token thuộc về (`/me`). */
  getPage(token: string): Promise<{ id: string; name: string; tasks?: string[] }>;
  debugToken(app: MetaApp, token: string): Promise<DebugInfo>;
  startReel(pageId: string, token: string): Promise<{ videoId: string; uploadUrl?: string }>;
  uploadReel(videoId: string, token: string, file: { path: string; size: number }, uploadUrl?: string): Promise<void>;
  finishReel(pageId: string, token: string, input: FinishInput): Promise<void>;
  reelStatus(videoId: string, token: string): Promise<ReelStatus>;
  /** Tài khoản Instagram Business/Creator liên kết với Page; null = Page chưa liên kết IG. */
  getInstagramAccount(pageId: string, token: string): Promise<{ id: string; username: string } | null>;
  createIgReel(igId: string, token: string, caption: string): Promise<{ containerId: string; uploadUrl?: string }>;
  uploadIgReel(containerId: string, token: string, file: { path: string; size: number }, uploadUrl?: string): Promise<void>;
  igContainerStatus(containerId: string, token: string): Promise<IgContainerStatus>;
  /** Trả id bài (media) trên Instagram. */
  publishIgReel(igId: string, token: string, containerId: string): Promise<string>;
  igPermalink(mediaId: string, token: string): Promise<string | undefined>;
}

export type FetchLike = (url: string, init?: RequestInit & { duplex?: 'half' }) => Promise<Response>;

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Phân loại lỗi Graph: mạng/5xx/mã giới hạn tốc độ → tạm thời; token hết hạn, thiếu quyền, 4xx khác → không.
 *  rupload báo lỗi dạng `{ debug_info: { retriable, type, message } }` thay vì `{ error }`. */
export function classifyGraphError(status: number, body: unknown): MetaError {
  const b = body as { error?: { message?: unknown; code?: unknown }; debug_info?: { message?: unknown; type?: unknown; retriable?: unknown } } | null;
  const err = b?.error ?? {};
  const dbg = b?.debug_info;
  const code = typeof err.code === 'number' ? err.code : undefined;
  const dbgText = s(dbg?.message) && (s(dbg?.type) ? `${s(dbg?.type)}: ${s(dbg?.message)}` : s(dbg?.message));
  const text = s(err.message) ?? dbgText ?? `HTTP ${status}`;
  const tokenExpired = code === TOKEN_EXPIRED_CODE;
  const transient = !tokenExpired && (status >= 500 || (code !== undefined && TRANSIENT_CODES.has(code)) || dbg?.retriable === true);
  return new MetaError(`Meta báo lỗi${code !== undefined ? ` ${code}` : ''}: ${text}`, { transient, code, tokenExpired });
}

const sec = (n: unknown): number | null => (typeof n === 'number' && n > 0 ? n * 1000 : null);

export function createMetaClient(fetchFn: FetchLike = (url, init) => fetch(url, init)): MetaClient {
  async function call(url: string, init: RequestInit & { duplex?: 'half' } = {}): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(url, init);
    } catch (e) {
      // Lỗi mạng: thông báo gốc có thể kèm URL nên chỉ giữ tên lỗi.
      throw new MetaError(`Không gọi được Meta (lỗi mạng${e instanceof Error && e.name ? `: ${e.name}` : ''})`, { transient: true });
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // thân không phải JSON
    }
    if (!res.ok || (body && typeof body === 'object' && ('error' in (body as object) || 'debug_info' in (body as object)))) throw classifyGraphError(res.status, body);
    return (body ?? {}) as Record<string, unknown>;
  }
  const auth = (token: string): Record<string, string> => ({ Authorization: `OAuth ${token}` });
  const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const form = (token: string, o: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs(o),
  });
  async function rupload(url: string, tok: string, file: { path: string; size: number }) {
    const stream = createReadStream(file.path);
    try {
      await call(url, {
        method: 'POST',
        // Content-Length bắt buộc: thiếu nó fetch gửi Transfer-Encoding: chunked, rupload trả 400 ParameterValidationError.
        headers: { ...auth(tok), offset: '0', file_size: String(file.size), 'Content-Length': String(file.size) },
        body: Readable.toWeb(stream) as unknown as ReadableStream,
        duplex: 'half',
      });
    } finally {
      stream.destroy();
    }
  }
  const token = (r: Record<string, unknown>): TokenInfo => {
    const accessToken = s(r.access_token);
    if (!accessToken) throw new MetaError('Meta không trả access token', { transient: false });
    return { accessToken, ...(typeof r.expires_in === 'number' ? { expiresIn: r.expires_in } : {}) };
  };

  return {
    async exchangeCode(app, code, redirectUri) {
      return token(await call(`${GRAPH_URL}/oauth/access_token?${qs({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code })}`));
    },
    async exchangeLongLived(app, userToken) {
      return token(await call(`${GRAPH_URL}/oauth/access_token?${qs({ grant_type: 'fb_exchange_token', client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: userToken })}`));
    },
    async listPages(userToken) {
      const r = await call(`${GRAPH_URL}/me/accounts?${qs({ fields: 'id,name,access_token,tasks', limit: '100' })}`, { headers: auth(userToken) });
      return ((Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[]).flatMap((p) => {
        const id = s(p.id);
        const accessToken = s(p.access_token);
        return id && accessToken ? [{ id, name: s(p.name) ?? id, accessToken, tasks: Array.isArray(p.tasks) ? p.tasks.map(String) : [] }] : [];
      });
    },
    async getPage(tok) {
      const r = await call(`${GRAPH_URL}/me?${qs({ fields: 'id,name,tasks' })}`, { headers: auth(tok) });
      const id = s(r.id);
      if (!id) throw new MetaError('Token không thuộc về một Page', { transient: false });
      return { id, name: s(r.name) ?? id, ...(Array.isArray(r.tasks) ? { tasks: r.tasks.map(String) } : {}) };
    },
    async debugToken(app, tok) {
      const r = (await call(`${GRAPH_URL}/debug_token?${qs({ input_token: tok })}`, { headers: auth(`${app.appId}|${app.appSecret}`) })).data as Record<string, unknown> | undefined;
      return {
        isValid: r?.is_valid === true,
        expiresAt: sec(r?.expires_at),
        dataAccessExpiresAt: sec(r?.data_access_expires_at),
        scopes: Array.isArray(r?.scopes) ? (r!.scopes as unknown[]).map(String) : [],
      };
    },
    async startReel(pageId, tok) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(pageId)}/video_reels`, form(tok, { upload_phase: 'start' }));
      const videoId = s(r.video_id);
      if (!videoId) throw new MetaError('Meta không trả video_id khi bắt đầu upload', { transient: false });
      return { videoId, uploadUrl: s(r.upload_url) };
    },
    async uploadReel(videoId, tok, file, uploadUrl) {
      await rupload(uploadUrl ?? `${RUPLOAD_URL}/${encodeURIComponent(videoId)}`, tok, file);
    },
    async finishReel(pageId, tok, i) {
      const params: Record<string, string> = { upload_phase: 'finish', video_id: i.videoId, video_state: i.state, description: i.description };
      if (i.state === 'SCHEDULED' && i.scheduledPublishTime !== undefined) params.scheduled_publish_time = String(i.scheduledPublishTime);
      if (SEND_AI_FLAG && i.aiGenerated) params[AI_FLAG_PARAM] = 'true';
      await call(`${GRAPH_URL}/${encodeURIComponent(pageId)}/video_reels`, form(tok, params));
    },
    async reelStatus(videoId, tok) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(videoId)}?${qs({ fields: 'status,permalink_url' })}`, { headers: auth(tok) });
      return parseReelStatus(r);
    },
    async getInstagramAccount(pageId, tok) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(pageId)}?${qs({ fields: 'instagram_business_account{id,username}' })}`, { headers: auth(tok) });
      const ig = (r.instagram_business_account ?? null) as Record<string, unknown> | null;
      const id = s(ig?.id);
      return id ? { id, username: s(ig?.username) ?? id } : null;
    },
    async createIgReel(igId, tok, caption) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(igId)}/media`, form(tok, { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true' }));
      const containerId = s(r.id);
      if (!containerId) throw new MetaError('Instagram không trả id container khi tạo bài', { transient: false });
      return { containerId, uploadUrl: s(r.uri) };
    },
    async uploadIgReel(containerId, tok, file, uploadUrl) {
      await rupload(uploadUrl ?? `${IG_RUPLOAD_URL}/${encodeURIComponent(containerId)}`, tok, file);
    },
    async igContainerStatus(containerId, tok) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(containerId)}?${qs({ fields: 'status_code,status' })}`, { headers: auth(tok) });
      return parseIgStatus(r);
    },
    async publishIgReel(igId, tok, containerId) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(igId)}/media_publish`, form(tok, { creation_id: containerId }));
      const id = s(r.id);
      if (!id) throw new MetaError('Instagram không trả id bài sau khi đăng', { transient: false });
      return id;
    },
    async igPermalink(mediaId, tok) {
      const r = await call(`${GRAPH_URL}/${encodeURIComponent(mediaId)}?${qs({ fields: 'permalink' })}`, { headers: auth(tok) });
      return s(r.permalink);
    },
  };
}

const IG_CODES: readonly IgContainerCode[] = ['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED'];

/** Chuẩn hoá trạng thái container Instagram; mã lạ coi như đang xử lý. `status` là chuỗi mô tả lỗi khi ERROR. */
export function parseIgStatus(r: Record<string, unknown>): IgContainerStatus {
  const code = s(r.status_code);
  const status = code && (IG_CODES as readonly string[]).includes(code) ? (code as IgContainerCode) : 'IN_PROGRESS';
  const detail = s(r.status);
  return status === 'ERROR' || status === 'EXPIRED' ? { status, ...(detail ? { error: detail } : {}) } : { status };
}

const link = (p: unknown): string | undefined => {
  const v = s(p);
  if (!v) return;
  return v.startsWith('http') ? v : `https://www.facebook.com${v.startsWith('/') ? '' : '/'}${v}`;
};

/** Chuẩn hoá phản hồi trạng thái Reel (status.video_status, uploading/processing/publishing_phase). Cần kiểm chứng với phản hồi thật. */
export function parseReelStatus(r: Record<string, unknown>): ReelStatus {
  const st = (r.status ?? {}) as Record<string, any>;
  const permalink = link(r.permalink_url);
  const phaseError = ['uploading_phase', 'processing_phase', 'publishing_phase'].map((k) => st[k]).find((p) => p?.status === 'error');
  if (st.video_status === 'error' || phaseError) {
    const detail = phaseError?.errors?.[0]?.message ?? st.processing_phase?.errors?.[0]?.message;
    return { phase: 'error', error: typeof detail === 'string' ? detail : 'Meta báo video bị lỗi khi xử lý' };
  }
  const pub = st.publishing_phase;
  if (pub?.publish_status === 'published' || (pub?.status === 'complete' && pub?.publish_status !== 'scheduled')) return { phase: 'published', ...(permalink ? { permalink } : {}) };
  if (pub?.publish_status === 'scheduled') return { phase: 'scheduled', ...(permalink ? { permalink } : {}) };
  if (st.uploading_phase?.status === 'complete' || st.processing_phase?.status === 'in_progress' || st.video_status === 'processing' || st.video_status === 'ready')
    return { phase: 'processing', ...(permalink ? { permalink } : {}) };
  return { phase: 'uploading' };
}
