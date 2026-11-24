// Hạn mức gói thuê bao (TK3 mục 7). Nguồn: `rate_limit_event` trong stream của Claude Code (S5). Hạn mức này dùng chung
// với chính người dùng, nên app cảnh báo ở 80% và ngừng giao lượt mới ở 95%.

import { and, eq, isNull } from 'drizzle-orm';
import { agents, conversations, messages, providerStatus } from '../db/schema.ts';
import { newId } from '../ids.ts';
import type { DbLike, UnitOfWork } from '../core/unitOfWork.ts';

export interface RateLimitWindow {
  utilization: number;
  /** Giây epoch, như CLI báo. */
  resetsAt: number;
}

export interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  isUsingOverage?: boolean;
  unifiedWindows?: { five_hour?: RateLimitWindow; seven_day?: RateLimitWindow };
}

export const WARN_AT = 0.8;
export const STOP_AT = 0.95;
const MIN = 60_000;
const BACKOFF_START = 15 * MIN;
const BACKOFF_MAX = 120 * MIN;
const FOREVER = Number.MAX_SAFE_INTEGER;

function current(u: UnitOfWork, provider: string) {
  const row = u.tx.select().from(providerStatus).where(eq(providerStatus.provider, provider)).get();
  if (row) return row;
  u.tx.insert(providerStatus).values({ provider, updatedAt: u.now }).run();
  return u.tx.select().from(providerStatus).where(eq(providerStatus.provider, provider)).get()!;
}

function update(u: UnitOfWork, provider: string, set: Partial<typeof providerStatus.$inferInsert>) {
  u.tx.update(providerStatus).set({ ...set, updatedAt: u.now }).where(eq(providerStatus.provider, provider)).run();
}

function touchProviderAgents(u: UnitOfWork, provider: string) {
  u.touchAgents(u.tx.select({ id: agents.id }).from(agents).where(eq(agents.provider, provider)).all().map((a) => a.id));
}

/**
 * Tin hệ thống vào hội thoại Director của Workspace; `campaignId` đặt thì vào luồng chat của chiến dịch đó. Không đặt (hạn mức
 * gói/provider) thì không có luồng chat nào hiện nó: sự kiện mang `data.text` để web đưa vào thông báo chuông.
 */
export function notifyDirector(u: UnitOfWork, workspaceId: string, content: string, campaignId?: string) {
  const conv = u.tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), isNull(conversations.agentId)))
    .get();
  if (!conv) return;
  const id = newId();
  u.tx.insert(messages).values({ id, conversationId: conv.id, role: 'system', campaignId, content, kind: 'chat', createdAt: u.now }).run();
  u.emit({ type: 'message.created', workspaceId, campaignId, entity: { kind: 'message', id }, actor: 'system', data: { conversationId: conv.id, role: 'system', ...(campaignId ? {} : { text: content }) } });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

export function recordRateLimit(u: UnitOfWork, workspaceId: string, provider: string, info: RateLimitInfo): void {
  const row = current(u, provider);
  const windows = [info.unifiedWindows?.five_hour, info.unifiedWindows?.seven_day].filter((w): w is RateLimitWindow => !!w);
  const worst = windows.reduce<RateLimitWindow | undefined>((a, w) => (!a || w.utilization > a.utilization ? w : a), undefined);
  const set: Partial<typeof providerStatus.$inferInsert> = {
    utilization5h: info.unifiedWindows?.five_hour?.utilization ?? row.utilization5h,
    utilization7d: info.unifiedWindows?.seven_day?.utilization ?? row.utilization7d,
    resetsAt: worst ? worst.resetsAt * 1000 : row.resetsAt,
  };
  if (info.status === 'allowed') set.quotaBackoffMs = 0;
  if (worst && worst.utilization >= STOP_AT && row.blockReason !== 'overage') {
    set.blockedUntil = worst.resetsAt * 1000;
    set.blockReason = 'usage';
  }
  if (worst && worst.utilization >= WARN_AT && row.warnedResetsAt !== worst.resetsAt * 1000) {
    set.warnedResetsAt = worst.resetsAt * 1000;
    const stop = worst.utilization >= STOP_AT ? ` Tạm ngừng giao việc mới tới ${clock(worst.resetsAt * 1000)}.` : '';
    notifyDirector(u, workspaceId, `Đã dùng ${pct(worst.utilization)} hạn mức gói ${provider}; hồi lại lúc ${clock(worst.resetsAt * 1000)}.${stop}`);
  }
  update(u, provider, set);
  if (set.blockedUntil !== undefined) touchProviderAgents(u, provider);
}

export function isProviderBlocked(tx: DbLike, provider: string, now: number): boolean {
  const row = tx.select({ until: providerStatus.blockedUntil }).from(providerStatus).where(eq(providerStatus.provider, provider)).get();
  return row?.until != null && row.until > now;
}

export function blockForQuota(u: UnitOfWork, provider: string, resetsAtMs?: number): void {
  const row = current(u, provider);
  const backoff = row.quotaBackoffMs ? Math.min(row.quotaBackoffMs * 2, BACKOFF_MAX) : BACKOFF_START;
  update(u, provider, { blockedUntil: resetsAtMs ?? u.now + backoff, blockReason: 'quota', quotaBackoffMs: resetsAtMs ? row.quotaBackoffMs : backoff });
  touchProviderAgents(u, provider);
}

export function blockForOverage(u: UnitOfWork, workspaceId: string, provider: string): void {
  current(u, provider);
  update(u, provider, { blockedUntil: FOREVER, blockReason: 'overage' });
  notifyDirector(
    u,
    workspaceId,
    `Đã dừng mọi lượt chạy ${provider} vì CLI báo đang dùng mức vượt có tính phí. App không được tốn thêm tiền: hãy tắt "extra usage" trong tài khoản rồi mở khoá lại.`,
  );
  touchProviderAgents(u, provider);
}

export function unblockProvider(u: UnitOfWork, provider: string): void {
  current(u, provider);
  update(u, provider, { blockedUntil: null, blockReason: null, quotaBackoffMs: 0 });
  touchProviderAgents(u, provider);
}
