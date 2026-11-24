import type { CampaignDetail, DomainEvent } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import type { SystemNotice } from '../campaign/api.ts';
import { createNoticeStore, type Channel } from './noticeStore.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));
const ev = (type: string, data: unknown, over: Partial<DomainEvent> = {}) => ({ seq: 1, at: 1000, type, workspaceId: 'w', campaignId: 'c1', entity: { kind: 'task', id: 'T1' }, actor: 'system', data, ...over }) as DomainEvent;

function setup(open: Partial<Record<Channel, boolean>> = {}, sys: SystemNotice[] = []) {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const detail = {
    campaign: { id: 'c1', title: 'iPad' },
    tasks: [{ id: 'T1', kind: 'research.trend', requiredRole: 'researcher', assigneeAgentId: 'A1', attempt: 1, input: { title: 'Xu hướng video ngắn', instructions: 'Nghiên cứu xu hướng TikTok.' } }],
    artifacts: [{ id: 'R1', taskId: 'T1', kind: 'research_report', content: { text: '**Báo cáo xu hướng**\nchi tiết' } }],
  } as unknown as CampaignDetail;
  const store = createNoticeStore({ api: { getCampaign: async () => detail, listSystemNotices: async () => sys }, isOpen: (c) => !!open[c], nameOf: (id) => (id === 'A1' ? 'An' : undefined), storage });
  return { store, storage };
}

describe('thông báo', () => {
  it('task xong → chuông có thông báo mô tả việc, ai làm, kết quả', async () => {
    const { store } = setup();
    store.onEvent(ev('task.status_changed', { from: 'in_review', to: 'done', attempt: 1 }));
    await flush();
    const [n] = store.get().items;
    expect(n).toMatchObject({ kind: 'task_done', title: 'An đã xong: Xu hướng video ngắn', campaignTitle: 'iPad' });
    expect(n!.body).toContain('Nghiên cứu xu hướng TikTok.');
    expect(n!.body).toContain('Kết quả: Báo cáo xu hướng');
    expect(store.get().bellUnread).toBe(true);
    store.seen('bell');
    expect(store.get().bellUnread).toBe(false);
  });

  it('task chuyển trạng thái khác "done" không báo; cùng task không báo 2 lần', async () => {
    const { store } = setup();
    store.onEvent(ev('task.status_changed', { from: 'queued', to: 'running', attempt: 1 }));
    store.onEvent(ev('task.status_changed', { from: 'in_review', to: 'done', attempt: 1 }));
    store.onEvent(ev('task.status_changed', { from: 'in_review', to: 'done', attempt: 1 }));
    await flush();
    expect(store.get().items).toHaveLength(1);
  });

  it('tin của Director khi chat đang đóng → chấm đỏ; tin của mình hoặc chat đang mở thì không', () => {
    const closed = setup().store;
    closed.onEvent(ev('message.created', { role: 'user' }));
    expect(closed.get().chatUnread).toBe(false);
    closed.onEvent(ev('message.created', { role: 'agent' }));
    expect(closed.get().chatUnread).toBe(true);
    closed.seen('chat');
    expect(closed.get().chatUnread).toBe(false);
    const open = setup({ chat: true }).store;
    open.onEvent(ev('message.created', { role: 'agent' }));
    expect(open.get().chatUnread).toBe(false);
  });

  it('tin hệ thống không gắn chiến dịch → thông báo chuông kind system, không bật chấm đỏ chat', () => {
    const { store } = setup();
    store.onEvent(ev('message.created', { role: 'system', text: 'Gói đã dùng 80%' }, { campaignId: undefined, entity: { kind: 'message', id: 'M1' } }));
    expect(store.get().chatUnread).toBe(false);
    expect(store.get().items[0]).toMatchObject({ kind: 'system', title: 'Thông báo hệ thống', body: 'Gói đã dùng 80%' });
    expect(store.get().bellUnread).toBe(true);
  });

  it('cần duyệt → nút Campaign báo và chuông có thông báo', () => {
    const { store } = setup();
    store.onEvent(ev('approval.requested', {}, { entity: { kind: 'approval', id: 'AP1' } }));
    expect(store.get().campaignUnread).toBe(true);
    expect(store.get().items[0]).toMatchObject({ kind: 'approval' });
  });

  it('danh sách chuông giữ lại sau khi tải lại trang', async () => {
    const { store, storage } = setup();
    store.onEvent(ev('task.status_changed', { from: 'in_review', to: 'done', attempt: 1 }));
    await flush();
    const again = createNoticeStore({ api: { getCampaign: async () => { throw new Error('x'); }, listSystemNotices: async () => [] }, isOpen: () => false, nameOf: () => undefined, storage });
    expect(again.get().items).toHaveLength(1);
    expect(again.get().bellUnread).toBe(true);
  });
});

describe('nạp tin hệ thống khi mở trang', () => {
  const rows: SystemNotice[] = [
    { id: 'M2', content: 'Gói đã dùng 90%', createdAt: 2000 },
    { id: 'M1', content: 'Gói đã dùng 80%', createdAt: 1000 },
  ];

  it('snapshot nạp tin system tạo lúc không mở web: id system:<id>, mới nhất trước, bật chấm chuông', async () => {
    const { store } = setup({}, rows);
    store.onSnapshot();
    await flush();
    expect(store.get().items.map((n) => [n.id, n.kind, n.body])).toEqual([
      ['system:M2', 'system', 'Gói đã dùng 90%'],
      ['system:M1', 'system', 'Gói đã dùng 80%'],
    ]);
    expect(store.get().bellUnread).toBe(true);
  });

  it('không trùng tin đã đến qua sự kiện trực tiếp, và nạp lại nhiều lần không nhân đôi', async () => {
    const { store } = setup({}, rows);
    store.onEvent(ev('message.created', { role: 'system', text: 'Gói đã dùng 80%' }, { campaignId: undefined, at: 1000, entity: { kind: 'message', id: 'M1' } }));
    store.onSnapshot();
    store.onSnapshot();
    await flush();
    expect(store.get().items.map((n) => n.id).sort()).toEqual(['system:M1', 'system:M2']);
  });

  it('tin đã xoá khỏi chuông (clear) hoặc cũ hơn mốc đã thấy không bị thêm lại; tin mới hơn thì có; nhớ qua tải lại trang', async () => {
    const { store, storage } = setup({}, rows);
    store.onSnapshot();
    await flush();
    store.clear();
    store.onSnapshot();
    await flush();
    expect(store.get().items).toEqual([]);
    const reloaded = createNoticeStore({ api: { getCampaign: async () => { throw new Error('x'); }, listSystemNotices: async () => [{ id: 'M3', content: 'Mới', createdAt: 3000 }, ...rows] }, isOpen: () => false, nameOf: () => undefined, storage });
    reloaded.onSnapshot();
    await flush();
    expect(reloaded.get().items.map((n) => n.id)).toEqual(['system:M3']);
  });

  it('chuông đang mở thì không bật chấm; lỗi mạng bị bỏ qua', async () => {
    const open = setup({ bell: true }, rows);
    open.store.onSnapshot();
    await flush();
    expect(open.store.get().items).toHaveLength(2);
    expect(open.store.get().bellUnread).toBe(false);
    const broken = createNoticeStore({ api: { getCampaign: async () => { throw new Error('x'); }, listSystemNotices: async () => { throw new Error('net'); } }, isOpen: () => false, nameOf: () => undefined });
    broken.onSnapshot();
    await flush();
    expect(broken.get().items).toEqual([]);
  });
});
