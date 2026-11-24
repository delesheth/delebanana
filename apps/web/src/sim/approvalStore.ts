// Store Approval đang chờ + trạng thái provider, ngoài React (subscribe/get cho useSyncExternalStore).
// Không dựng trạng thái từ dữ liệu sự kiện (sự kiện không mang đủ nội dung): nhận snapshot/sự kiện liên quan thì nạp lại bằng HTTP.
// Nạp lại đang chạy thì gộp: sự kiện đến giữa chừng chỉ đặt cờ, chạy thêm đúng một lần sau đó.

import type { DomainEvent } from '@delebanana/domain';
import { createApi, type Api, type ApprovalRow, type DecideStatus, type ProviderStatusRow, type VideoUploadResult } from '../live/api.ts';

export type ErrorSource = 'decide' | 'unblock' | 'approvals' | 'providers';

export interface ApprovalState {
  approvals: readonly ApprovalRow[];
  providers: readonly ProviderStatusRow[];
  /** Lỗi gần nhất theo từng nguồn; mỗi nguồn chỉ bị xoá bởi chính nó (lần thử/nạp lại thành công kế tiếp). */
  errors: Readonly<Record<ErrorSource, string | null>>;
}

type Slot = 'approvals' | 'providers';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ApprovalStore {
  private state: ApprovalState = {
    approvals: [],
    providers: [],
    errors: { decide: null, unblock: null, approvals: null, providers: null },
  };
  private listeners = new Set<() => void>();
  private running = new Set<Slot>();
  private dirty = new Set<Slot>();
  /** Đối tượng gây lỗi decide/unblock gần nhất; để xoá lỗi khi nạp lại cho thấy không còn thao tác nào để thử lại. */
  private decideErrorId: string | null = null;
  private unblockErrorProvider: string | null = null;

  private readonly api: Api;
  constructor(api: Api) {
    this.api = api;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get = (): ApprovalState => this.state;

  private set(patch: Partial<ApprovalState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private setError(source: ErrorSource, e: unknown) {
    this.set({ errors: { ...this.state.errors, [source]: e === null ? null : messageOf(e) } });
  }

  private async refresh(slot: Slot): Promise<void> {
    if (this.running.has(slot)) {
      this.dirty.add(slot);
      return;
    }
    this.running.add(slot);
    try {
      do {
        this.dirty.delete(slot);
        try {
          if (slot === 'approvals') {
            this.set({ approvals: await this.api.pendingApprovals() });
            if (this.decideErrorId !== null && !this.state.approvals.some((a) => a.id === this.decideErrorId)) {
              this.decideErrorId = null;
              this.setError('decide', null);
            }
          } else {
            this.set({ providers: await this.api.providers() });
            const now = Date.now();
            const stillBlocked = this.state.providers.some(
              (p) => p.provider === this.unblockErrorProvider && p.blockedUntil !== null && p.blockedUntil > now,
            );
            if (this.unblockErrorProvider !== null && !stillBlocked) {
              this.unblockErrorProvider = null;
              this.setError('unblock', null);
            }
          }
          if (this.state.errors[slot] !== null) this.setError(slot, null);
        } catch (e) {
          this.setError(slot, e);
        }
      } while (this.dirty.has(slot));
    } finally {
      this.running.delete(slot);
    }
  }

  refreshApprovals = () => this.refresh('approvals');
  refreshProviders = () => this.refresh('providers');

  onSnapshot(): void {
    void this.refreshApprovals();
    void this.refreshProviders();
  }

  onEvent(e: DomainEvent): void {
    // Xoá chiến dịch cũng xoá yêu cầu duyệt của nó.
    if (e.type === 'approval.requested' || e.type === 'approval.decided' || e.type === 'campaign.deleted' || e.type === 'video_version.status_changed') void this.refreshApprovals();
    else if (e.type === 'agent.state_changed') void this.refreshProviders();
  }

  /** Quyết định một Approval; lỗi (ví dụ 409) được giữ trong `errors.decide` và danh sách được nạp lại cho khớp server. */
  async decide(id: string, status: DecideStatus, decision: Record<string, unknown> = {}): Promise<boolean> {
    try {
      await this.api.decide(id, status, decision);
    } catch (e) {
      this.decideErrorId = id;
      this.setError('decide', e);
      await this.refreshApprovals();
      return false;
    }
    this.decideErrorId = null;
    if (this.state.errors.decide !== null) this.setError('decide', null);
    await this.refreshApprovals();
    return true;
  }

  /** Tải video cho một Approval make_video; lỗi (413, 503 thiếu ffprobe, 409…) giữ trong `errors.decide`. Kết quả kiểm tệp nằm ở `latestVideo` sau khi nạp lại. */
  async uploadVideo(makeVideoApprovalId: string, file: Blob): Promise<VideoUploadResult | undefined> {
    let result: VideoUploadResult;
    try {
      result = await this.api.uploadVideo(makeVideoApprovalId, file);
    } catch (e) {
      this.decideErrorId = makeVideoApprovalId;
      this.setError('decide', e);
      await this.refreshApprovals();
      return undefined;
    }
    this.decideErrorId = null;
    if (this.state.errors.decide !== null) this.setError('decide', null);
    await this.refreshApprovals();
    return result;
  }

  async unblock(provider: string): Promise<boolean> {
    try {
      await this.api.unblock(provider);
    } catch (e) {
      this.unblockErrorProvider = provider;
      this.setError('unblock', e);
      return false;
    }
    this.unblockErrorProvider = null;
    if (this.state.errors.unblock !== null) this.setError('unblock', null);
    await this.refreshProviders();
    return true;
  }
}

export const approvalStore = new ApprovalStore(createApi({ baseUrl: '/api' }));
