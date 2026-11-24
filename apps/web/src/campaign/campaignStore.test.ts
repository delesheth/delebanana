import type { CampaignDetail, CampaignRow, DomainEvent, MessageRow } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from './api.ts';
import { createCampaignStore } from './campaignStore.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));
const camp = (id: string) => ({ id, title: id }) as CampaignRow;
const detail = (id: string) => ({ campaign: camp(id), stages: [], tasks: [], artifacts: [], approvals: [] }) as CampaignDetail;
const ev = (type: string, campaignId?: string, actor = 'system') => ({ type, campaignId, actor }) as unknown as DomainEvent;

const notUsed = (): never => {
  throw new Error('không dùng');
};

function setup(over: Partial<ApiClient> = {}) {
  const calls: string[] = [];
  const api: ApiClient = {
    listCampaigns: async () => (calls.push('list'), [camp('a')]),
    createCampaign: async (t) => (calls.push(`create:${t}`), { id: 'new' }),
    deleteCampaign: async (id) => void calls.push(`delete:${id}`),
    getCampaign: async (id) => (calls.push(`get:${id}`), detail(id)),
    getTask: async () => {
      throw new Error('không dùng');
    },
    listDirectorMessages: async (cid) => (calls.push(`msgs:${cid}`), [{ id: 'm1', content: 'x' } as MessageRow]),
    sendDirectorMessage: async (c, cid, att) => (calls.push(`send:${c}@${cid}${att?.length ? `+${att.map((a) => a.id).join(',')}` : ''}`), { id: 'm2' }),
    uploadImage: async (img) => (calls.push(`upload:${img.name}`), { id: `u-${img.name}`, name: img.name, mime: img.mime }),
    // Phần đăng bài không dùng trong store này.
    getPublishAccounts: async () => notUsed(),
    saveFacebookApp: async () => notUsed(),
    connectFacebookToken: async () => notUsed(),
    selectFacebookPage: async () => notUsed(),
    disconnectAccount: async () => notUsed(),
    listPosts: async () => notUsed(),
    listSystemNotices: async () => notUsed(),
    retryPost: async () => notUsed(),
    markPostPublished: async () => notUsed(),
    cancelPost: async () => notUsed(),
    ...over,
  };
  const store = createCampaignStore(api);
  /** Chọn chiến dịch 'a' rồi bỏ các lời gọi nạp ban đầu khỏi `calls`. */
  const pick = async () => {
    store.select('a');
    await flush();
    calls.length = 0;
  };
  return { calls, store, pick };
}

describe('chat Director', () => {
  it('tải tin khi nạp snapshot', async () => {
    const { store, pick } = setup();
    await pick();
    store.onSnapshot();
    await flush();
    expect(store.get().messages).toHaveLength(1);
    expect(store.get().campaigns).toHaveLength(1);
  });

  it('gửi bằng POST rồi tải lại', async () => {
    const { store, calls, pick } = setup();
    await pick();
    expect(await store.send('  chào ')).toBe(true);
    await flush();
    expect(calls).toEqual(['send:chào@a', 'msgs:a']);
  });

  it('gửi ảnh: tải từng ảnh lên rồi gửi tin kèm ảnh (cho phép không có chữ)', async () => {
    const { store, calls, pick } = setup();
    await pick();
    const img = (name: string) => ({ name, mime: 'image/png', data: 'QUJD' });
    expect(await store.send(' ', [img('a'), img('b')])).toBe(true);
    await flush();
    expect(calls).toEqual(['upload:a', 'upload:b', 'send:@a+u-a,u-b', 'msgs:a']);
  });

  it('tải ảnh lỗi → không gửi tin, đặt chatError', async () => {
    const { store, calls, pick } = setup({ uploadImage: async () => { throw new Error('Ảnh quá lớn'); } });
    await pick();
    expect(await store.send('xem', [{ name: 'a', mime: 'image/png', data: 'x' }])).toBe(false);
    expect(store.get().chatError).toBe('Ảnh quá lớn');
    expect(calls).toEqual([]);
  });

  it('chưa chọn chiến dịch: không tải tin, tin rỗng, send() trả false không gọi API', async () => {
    const { store, calls } = setup();
    store.onSnapshot();
    store.onEvent(ev('message.created'));
    await flush();
    expect(store.get().messages).toEqual([]);
    expect(calls).toEqual(['list']);
    expect(await store.send('chào')).toBe(false);
    expect(calls).toEqual(['list']);
  });

  it('nội dung trống không gọi API', async () => {
    const { store, calls, pick } = setup();
    await pick();
    expect(await store.send('   ')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('lỗi gửi trả false và đặt chatError', async () => {
    const { store, calls, pick } = setup({ sendDirectorMessage: async () => { throw new Error('hỏng'); } });
    await pick();
    expect(await store.send('a')).toBe(false);
    expect(store.get().chatError).toBe('hỏng');
    expect(store.get().sending).toBe(false);
    expect(calls).toEqual([]);
  });

  it('tải lại nền thành công không xoá chatError của lần gửi lỗi', async () => {
    let fail = true;
    const { store, pick } = setup({
      sendDirectorMessage: async () => {
        if (fail) throw new Error('hỏng');
        return { id: 'm2' };
      },
    });
    await pick();
    await store.send('a');
    store.onEvent(ev('message.created'));
    store.onSnapshot();
    await flush();
    expect(store.get().chatError).toBe('hỏng');
    fail = false;
    expect(await store.send('a')).toBe(true);
    expect(store.get().chatError).toBeNull();
  });

  it('message.created tải lại tin', async () => {
    const { store, calls, pick } = setup();
    await pick();
    store.onEvent(ev('message.created'));
    await flush();
    expect(calls).toEqual(['msgs:a']);
  });
});

describe('danh sách Campaign', () => {
  it('campaign.created và campaign.status_changed tải lại danh sách', async () => {
    const { store, calls } = setup();
    store.onEvent(ev('campaign.created', 'x'));
    await flush();
    store.onEvent(ev('campaign.status_changed', 'x'));
    await flush();
    expect(calls).toEqual(['list', 'list']);
  });

  it('tạo bằng POST { title } rồi chọn Campaign mới', async () => {
    const { store, calls } = setup();
    expect(await store.create(' Hè ')).toBe('new');
    await flush();
    expect(calls).toContain('create:Hè');
    expect(calls).toContain('list');
    expect(store.get().selectedId).toBe('new');
    expect(store.get().detail?.campaign.id).toBe('new');
  });

  it('tiêu đề trống không gọi API', async () => {
    const { store, calls } = setup();
    expect(await store.create('  ')).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('chi tiết Campaign', () => {
  it('sự kiện cùng campaignId tải lại, khác thì không', async () => {
    const { store, calls } = setup();
    store.select('a');
    await flush();
    calls.length = 0;
    for (const t of ['stage.status_changed', 'task.created', 'artifact.created', 'approval.requested', 'campaign.status_changed']) store.onEvent(ev(t, 'a'));
    await flush();
    expect(calls.filter((c) => c === 'get:a').length).toBeGreaterThanOrEqual(1);
    calls.length = 0;
    store.onEvent(ev('task.created', 'b'));
    store.onEvent(ev('agent.state_changed'));
    await flush();
    expect(calls).toEqual([]);
  });

  it('chuỗi sự kiện dồn dập chỉ gây tối đa 1 đang chạy + 1 chờ', async () => {
    const gates: (() => void)[] = [];
    let gets = 0;
    const { store } = setup({
      getCampaign: (id) => (gets++, new Promise((res) => gates.push(() => res(detail(id))))),
    });
    store.select('a');
    for (let i = 0; i < 6; i++) store.onEvent(ev('task.created', 'a'));
    expect(gets).toBe(1);
    gates[0]!();
    await flush();
    expect(gets).toBe(2);
    gates[1]!();
    await flush();
    expect(gets).toBe(2);
  });

  it('phản hồi của Campaign đã bỏ chọn bị bỏ qua', async () => {
    const gates: Record<string, () => void> = {};
    const { store } = setup({
      getCampaign: (id) => new Promise((res) => (gates[id] = () => res(detail(id)))),
    });
    store.select('a');
    store.select('b');
    gates.a?.();
    await flush();
    expect(store.get().detail).toBeNull();
  });

  it('nạp snapshot tải lại chi tiết đang chọn', async () => {
    const { store, calls } = setup();
    store.select('a');
    await flush();
    calls.length = 0;
    store.onSnapshot();
    await flush();
    expect(calls.sort()).toEqual(['get:a', 'list', 'msgs:a']);
  });
});

describe('xoá Campaign', () => {
  it('xoá campaign đang chọn: bỏ chọn, gỡ khỏi danh sách, tải lại danh sách', async () => {
    let gone = false;
    const { store, calls } = setup({
      listCampaigns: async () => (calls.push('list'), gone ? [] : [camp('a')]),
      deleteCampaign: async (id) => {
        gone = true;
        calls.push(`delete:${id}`);
      },
    });
    store.onSnapshot();
    await flush();
    store.select('a');
    await flush();
    calls.length = 0;
    expect(await store.remove('a')).toBe(true);
    expect(store.get().selectedId).toBeNull();
    expect(store.get().campaigns.map((c) => c.id)).not.toContain('a');
    await flush();
    expect([...calls].sort()).toEqual(['delete:a', 'list']); // bỏ chọn → không có chat, không tải tin
  });

  it('server từ chối (đang chạy) → false, giữ nguyên, hiện lỗi', async () => {
    const { store } = setup({ deleteCampaign: async () => { throw new Error('Đội ngũ đang làm việc'); } });
    store.onSnapshot();
    await flush();
    expect(await store.remove('a')).toBe(false);
    expect(store.get().campaignError).toBe('Đội ngũ đang làm việc');
    expect(store.get().campaigns).toHaveLength(1);
  });

  it('sự kiện campaign.deleted của campaign đang chọn → bỏ chọn', async () => {
    const { store } = setup();
    store.select('a');
    store.onEvent(ev('campaign.deleted', 'a'));
    expect(store.get().selectedId).toBeNull();
  });
});

describe('luồng chat theo chiến dịch', () => {
  it('chọn chiến dịch → tải tin của chiến dịch đó, xoá tin luồng cũ; gửi kèm campaignId; bỏ chọn → không còn tin và không gửi được', async () => {
    const { store, calls } = setup();
    store.onSnapshot();
    await flush();
    expect(calls).not.toContain('msgs:a');
    store.select('a');
    expect(store.get().messages).toEqual([]);
    await flush();
    expect(calls).toContain('msgs:a');
    expect(store.get().messages).toHaveLength(1);
    expect(await store.send('hi')).toBe(true);
    await flush();
    expect(calls).toContain('send:hi@a');
    store.select(null);
    await flush();
    expect(store.get().messages).toEqual([]);
    calls.length = 0;
    expect(await store.send('chung')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('kết quả tải muộn của luồng cũ bị bỏ', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const { store } = setup({
      listDirectorMessages: async (cid) => {
        if (cid === 'a') await slow;
        return [{ id: cid, content: cid } as MessageRow];
      },
    });
    store.select('a'); // đang tải 'a' (chậm)
    store.select('b');
    release();
    await flush();
    await flush();
    expect(store.get().messages.map((m) => m.id)).toEqual(['b']);
  });

  it('create(title): POST /campaigns rồi chọn chiến dịch mới và tải tin của nó', async () => {
    const { store, calls } = setup();
    expect(await store.create('Hè')).toBe('new');
    await flush();
    expect(store.get().selectedId).toBe('new');
    expect(calls).toContain('msgs:new');
  });

  it('Agent tạo chiến dịch (campaign.created) không tự chuyển chiến dịch', async () => {
    const { store } = setup();
    store.onEvent(ev('campaign.created', 'n1', 'agent:d'));
    expect(store.get().selectedId).toBeNull();
  });
});
