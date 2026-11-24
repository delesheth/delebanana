import type { DomainEvent } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import { ApiError, type Api, type ApprovalRow, type ProviderStatusRow } from '../live/api.ts';
import { ApprovalStore } from './approvalStore.ts';

const ev = (type: string) => ({ type }) as unknown as DomainEvent;
const row = (id: string) => ({ id, kind: 'make_video', status: 'pending' }) as unknown as ApprovalRow;

function setup() {
  const calls: string[] = [];
  let pending: ApprovalRow[] = [row('A1')];
  let providers: ProviderStatusRow[] = [];
  let failDecide: Error | undefined;
  let failUnblock: Error | undefined;
  let failUpload: Error | undefined;
  let failApprovals: Error | undefined;
  let failProviders: Error | undefined;
  const gates: Array<() => void> = [];
  let hold = false;
  const api: Api = {
    pendingApprovals: async () => {
      calls.push('approvals');
      if (failApprovals) throw failApprovals;
      if (hold) await new Promise<void>((r) => gates.push(r));
      return pending;
    },
    providers: async () => {
      calls.push('providers');
      if (failProviders) throw failProviders;
      return providers;
    },
    decide: async (id, status) => {
      calls.push(`decide:${id}:${status}`);
      if (failDecide) throw failDecide;
      pending = pending.filter((a) => a.id !== id);
    },
    uploadVideo: async (id, file) => {
      calls.push(`upload:${id}:${(file as Blob).size}`);
      if (failUpload) throw failUpload;
      return { versionId: 'V', number: 1, status: 'ready', reasons: [] };
    },
    unblock: async (p) => {
      calls.push(`unblock:${p}`);
      if (failUnblock) throw failUnblock;
      providers = [{ provider: p, blockedUntil: null, blockReason: null, utilization5h: null, utilization7d: null, resetsAt: null }];
    },
  };
  return {
    store: new ApprovalStore(api),
    calls,
    gates,
    setPending: (p: ApprovalRow[]) => (pending = p),
    setProviders: (p: ProviderStatusRow[]) => (providers = p),
    setHold: (h: boolean) => (hold = h),
    failWith: (e: Error | undefined) => (failDecide = e),
    failUnblockWith: (e: Error | undefined) => (failUnblock = e),
    failUploadWith: (e: Error | undefined) => (failUpload = e),
    failApprovalsWith: (e: Error | undefined) => (failApprovals = e),
    failProvidersWith: (e: Error | undefined) => (failProviders = e),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ApprovalStore', () => {
  it('snapshot nạp cả Approval pending và provider', async () => {
    const s = setup();
    s.store.onSnapshot();
    await tick();
    expect(s.calls.sort()).toEqual(['approvals', 'providers']);
    expect(s.store.get().approvals).toHaveLength(1);
  });

  it('approval.requested / approval.decided nạp lại Approval; agent.state_changed nạp lại provider', async () => {
    const s = setup();
    s.store.onEvent(ev('approval.requested'));
    await tick();
    s.store.onEvent(ev('approval.decided'));
    await tick();
    s.store.onEvent(ev('campaign.deleted'));
    await tick();
    expect(s.calls).toEqual(['approvals', 'approvals', 'approvals']);
    s.store.onEvent(ev('agent.state_changed'));
    await tick();
    expect(s.calls.at(-1)).toBe('providers');
  });

  it('sự kiện khác không gọi gì', async () => {
    const s = setup();
    s.store.onEvent(ev('message.created'));
    await tick();
    expect(s.calls).toEqual([]);
  });

  it('gộp nạp lại đang chạy: bão sự kiện chỉ thêm một lần', async () => {
    const s = setup();
    s.setHold(true);
    for (let i = 0; i < 5; i++) s.store.onEvent(ev('approval.requested'));
    await tick();
    expect(s.calls).toEqual(['approvals']);
    s.setHold(false);
    s.gates.shift()!();
    await tick();
    expect(s.calls).toEqual(['approvals', 'approvals']);
  });

  it('decide thành công nạp lại danh sách', async () => {
    const s = setup();
    await s.store.refreshApprovals();
    expect(await s.store.decide('A1', 'approved')).toBe(true);
    expect(s.store.get().approvals).toHaveLength(0);
    expect(s.store.get().errors.decide).toBeNull();
  });

  it('decide lỗi giữ thông điệp server trong error', async () => {
    const s = setup();
    s.failWith(new ApiError('Yêu cầu này đã được quyết định', 409));
    expect(await s.store.decide('A1', 'approved')).toBe(false);
    expect(s.store.get().errors.decide).toBe('Yêu cầu này đã được quyết định');
  });

  it('unblock nạp lại provider', async () => {
    const s = setup();
    expect(await s.store.unblock('claude')).toBe(true);
    expect(s.store.get().providers[0]?.provider).toBe('claude');
  });

  it('nạp lại thành công không xoá lỗi của thao tác decide', async () => {
    const s = setup();
    s.failWith(new Error('409'));
    await s.store.decide('A1', 'approved');
    await s.store.refreshProviders();
    s.store.onEvent(ev('approval.decided'));
    await tick();
    expect(s.store.get().errors.decide).toBe('409');
  });

  it('decide thành công xoá lỗi trước đó (thử lại)', async () => {
    const s = setup();
    s.failWith(new Error('409'));
    await s.store.decide('A1', 'approved');
    s.failWith(undefined);
    expect(await s.store.decide('A1', 'approved')).toBe(true);
    expect(s.store.get().errors.decide).toBeNull();
  });

  it('unblock lỗi giữ trong errors.unblock, thử lại thành công thì xoá', async () => {
    const s = setup();
    s.failUnblockWith(new Error('mạng'));
    expect(await s.store.unblock('claude')).toBe(false);
    expect(s.store.get().errors.unblock).toBe('mạng');
    s.failUnblockWith(undefined);
    expect(await s.store.unblock('claude')).toBe(true);
    expect(s.store.get().errors.unblock).toBeNull();
  });

  it('nạp lại thành công xoá lỗi của chính nó', async () => {
    const s = setup();
    s.failApprovalsWith(new Error('mất mạng'));
    await s.store.refreshApprovals();
    expect(s.store.get().errors.approvals).toBe('mất mạng');
    s.failApprovalsWith(undefined);
    await s.store.refreshApprovals();
    expect(s.store.get().errors.approvals).toBeNull();
  });

  it('lỗi nạp lại một slot không bị slot kia hay thao tác xoá/ghi đè', async () => {
    const s = setup();
    s.failApprovalsWith(new Error('A'));
    s.failProvidersWith(new Error('P'));
    await s.store.refreshApprovals();
    await s.store.refreshProviders();
    expect(s.store.get().errors).toMatchObject({ approvals: 'A', providers: 'P' });
    s.failProvidersWith(undefined);
    await s.store.refreshProviders();
    expect(s.store.get().errors).toMatchObject({ approvals: 'A', providers: null });
    s.failUnblockWith(new Error('U'));
    await s.store.unblock('claude');
    s.failUnblockWith(undefined);
    s.failWith(new Error('D'));
    await s.store.decide('A1', 'approved');
    expect(s.store.get().errors).toEqual({ decide: 'D', unblock: 'U', approvals: 'A', providers: null });
  });

  it('decide/unblock thành công chỉ xoá lỗi của chính nó', async () => {
    const s = setup();
    s.failWith(new Error('D'));
    s.failUnblockWith(new Error('U'));
    await s.store.decide('A1', 'approved');
    await s.store.unblock('claude');
    s.failUnblockWith(undefined);
    await s.store.unblock('claude');
    expect(s.store.get().errors).toMatchObject({ decide: 'D', unblock: null });
  });

  it('lỗi decide không che lỗi nạp lại sau đó', async () => {
    const s = setup();
    s.failWith(new Error('409'));
    s.failApprovalsWith(new Error('nạp lỗi'));
    await s.store.decide('A1', 'approved');
    expect(s.store.get().errors).toMatchObject({ decide: '409', approvals: 'nạp lỗi' });
  });

  it('decide trả 409 khi danh sách chỉ còn 1 phần tử: lần nạp lại thấy không còn pending thì xoá lỗi', async () => {
    const s = setup();
    s.failWith(new ApiError('Yêu cầu này đã được quyết định', 409));
    s.setPending([]);
    expect(await s.store.decide('A1', 'approved')).toBe(false);
    expect(s.store.get().approvals).toHaveLength(0);
    expect(s.store.get().errors.decide).toBeNull();
  });

  it('lỗi decide còn nguyên khi Approval vẫn pending sau nạp lại', async () => {
    const s = setup();
    s.failWith(new ApiError('lỗi', 500));
    await s.store.decide('A1', 'approved');
    expect(s.store.get().errors.decide).toBe('lỗi');
  });

  it('provider hết bị chặn tự nhiên: lần nạp lại xoá lỗi unblock', async () => {
    const s = setup();
    s.setProviders([{ provider: 'claude', blockedUntil: Date.now() + 3_600_000, blockReason: 'quota', utilization5h: null, utilization7d: null, resetsAt: null }]);
    s.failUnblockWith(new Error('mạng'));
    await s.store.unblock('claude');
    expect(s.store.get().errors.unblock).toBe('mạng');
    s.setProviders([{ provider: 'claude', blockedUntil: null, blockReason: null, utilization5h: null, utilization7d: null, resetsAt: null }]);
    s.store.onEvent(ev('agent.state_changed'));
    await tick();
    expect(s.store.get().errors.unblock).toBeNull();
  });
});

describe('ApprovalStore — tải video', () => {
  it('tải xong → trả kết quả và nạp lại danh sách; sự kiện video_version nạp lại', async () => {
    const s = setup();
    const r = await s.store.uploadVideo('A1', new Blob(['abc']));
    expect(r).toMatchObject({ status: 'ready' });
    expect(s.calls).toContain('upload:A1:3');
    expect(s.calls).toContain('approvals');
    s.calls.length = 0;
    s.store.onEvent(ev('video_version.status_changed'));
    await tick();
    expect(s.calls).toEqual(['approvals']);
  });

  it('lỗi server (vd. 503 thiếu ffprobe) giữ trong errors.decide, trả undefined', async () => {
    const s = setup();
    s.failUploadWith(new ApiError('Chưa cài ffprobe. Cài bằng `brew install ffmpeg` rồi tải lại.', 503));
    expect(await s.store.uploadVideo('A1', new Blob(['abc']))).toBeUndefined();
    expect(s.store.get().errors.decide).toContain('brew install ffmpeg');
  });
});
