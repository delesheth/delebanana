import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../agents/gateway.ts';
import { blockForOverage, isProviderBlocked, notifyDirector } from '../agents/usage.ts';
import { EventBus } from '../core/bus.ts';
import { runTx } from '../core/unitOfWork.ts';
import { agents, approvals, artifacts, campaignStages, campaigns, cliRuns, conversations, messages, tasks, workspaces } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { createApp } from './app.ts';

function setup() {
  const { db, ids } = minimal();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => ++now };
  const gateway = new Gateway(deps);
  const app = createApp(deps, { gateway });
  const req = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return { status: res.status, body: await res.json() };
  };
  return { db, ids, deps, req };
}

/** Dựng Campaign ở bước chọn kịch bản, trả id Approval và 3 artifact. */
async function atChooseScript(s: ReturnType<typeof setup>) {
  const { body } = await s.req('POST', '/campaigns', { title: 'Bông Bông' });
  const cid = body.id as string;
  s.db.update(campaigns).set({ status: 'active', currentStage: 'scripting' }).where(eq(campaigns.id, cid)).run();
  s.db.update(campaignStages).set({ status: 'awaiting_approval' }).where(and(eq(campaignStages.campaignId, cid), eq(campaignStages.stage, 'scripting'))).run();
  s.db.update(campaignStages).set({ status: 'done' }).where(and(eq(campaignStages.campaignId, cid), eq(campaignStages.stage, 'research'))).run();
  const ids = ['A1', 'A2', 'A3'];
  s.db.insert(artifacts).values(ids.map((id) => ({ id, campaignId: cid, kind: 'script', content: { text: id }, createdAt: T0 }))).run();
  s.db.insert(approvals).values({ id: 'AP1', workspaceId: s.ids.workspace, campaignId: cid, kind: 'choose_script', subject: { kind: 'artifact', ids }, requestedByAgentId: s.ids.director, status: 'pending', createdAt: T0, updatedAt: T0 }).run();
  return { cid, ids };
}

describe('Campaign và hội thoại', () => {
  it('tạo Campaign → 201, có trong danh sách và chi tiết', async () => {
    const s = setup();
    const r = await s.req('POST', '/campaigns', { title: 'Bông Bông' });
    expect(r.status).toBe(201);
    expect((await s.req('GET', '/campaigns')).body.map((c: { id: string }) => c.id)).toContain(r.body.id);
    const d = await s.req('GET', `/campaigns/${r.body.id}`);
    expect(d.body.campaign).toMatchObject({ status: 'briefing', title: 'Bông Bông' });
    expect(d.body.stages).toHaveLength(5);
    expect((await s.req('GET', '/campaigns/khong-co')).status).toBe(404);
  });

  it('tạo Campaign → Director gửi ngay một tin hỏi đủ các ý của brief', async () => {
    const s = setup();
    const cid = (await s.req('POST', '/campaigns', { title: 'Bông Bông' })).body.id as string;
    const list = (await s.req('GET', `/conversations/director/messages?campaignId=${cid}`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ role: 'agent', agentId: s.ids.director, campaignId: cid, kind: 'question' });
    for (const ý of ['Mục tiêu', 'Đối tượng', 'Sản phẩm', 'Nền tảng', '"Bông Bông"']) expect(list[0].content).toContain(ý);
  });

  it('GET /tasks/:id trả task kèm tên Campaign; không có → 404', async () => {
    const s = setup();
    const r = await s.req('GET', `/tasks/${s.ids.task}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ task: { id: s.ids.task, kind: 'research.trend' }, campaignTitle: 'Trà sữa' });
    expect((await s.req('GET', '/tasks/khong-co')).status).toBe(404);
  });

  it('tiêu đề rỗng hoặc body không phải JSON → 400', async () => {
    const s = setup();
    expect((await s.req('POST', '/campaigns', { title: ' ' })).status).toBe(400);
    expect((await s.req('POST', '/campaigns', 'không phải json')).status).toBe(400);
  });

  it('gửi tin cho Director → xuất hiện trong hội thoại', async () => {
    const s = setup();
    const cid = (await s.req('POST', '/campaigns', { title: 'A' })).body.id as string;
    const r = await s.req('POST', '/conversations/director/messages', { content: 'Chào Linh', campaignId: cid });
    expect(r.status).toBe(201);
    const list = (await s.req('GET', `/conversations/director/messages?campaignId=${cid}`)).body;
    expect(list.at(-1)).toMatchObject({ role: 'user', content: 'Chào Linh' });
    expect((await s.req('POST', '/conversations/director/messages', { content: '', campaignId: cid })).status).toBe(400);
  });
});

describe('xoá Campaign', () => {
  it('luồng chat: thiếu/sai campaignId → 400; hợp lệ → chỉ tin của chiến dịch; tin campaignId null không bao giờ trả về', async () => {
    const s = setup();
    const cid = (await s.req('POST', '/campaigns', { title: 'A' })).body.id as string;
    const cid2 = (await s.req('POST', '/campaigns', { title: 'B' })).body.id as string;
    const conv = s.db.select().from(conversations).where(isNull(conversations.agentId)).get()!;
    // Tin cũ của luồng "Chung" (campaignId null) còn trong DB.
    s.db.insert(messages).values({ id: 'OLD', conversationId: conv.id, role: 'user', campaignId: null, content: 'chung cũ', kind: 'chat', createdAt: T0 }).run();
    expect((await s.req('POST', '/conversations/director/messages', { content: 'thiếu' })).status).toBe(400);
    expect((await s.req('POST', '/conversations/director/messages', { content: 'của A', campaignId: cid })).status).toBe(201);
    await s.req('POST', '/conversations/director/messages', { content: 'của B', campaignId: cid2 });
    // Bỏ tin hỏi brief mở đầu của Director: chỉ xét tin người dùng gửi vào luồng nào.
    const texts = async (q: string) =>
      (await s.req('GET', `/conversations/director/messages${q}`)).body.filter((m: { role: string }) => m.role === 'user').map((m: { content: string }) => m.content);
    expect((await s.req('GET', '/conversations/director/messages')).status).toBe(400);
    expect(await texts(`?campaignId=${cid}`)).toEqual(['của A']);
    expect((await s.req('GET', `/conversations/director/messages?campaignId=${cid}`)).body.at(-1)).toMatchObject({ role: 'user', campaignId: cid });
    expect((await s.req('POST', '/conversations/director/messages', { content: 'x', campaignId: 'khong-co' })).status).toBe(400);
    expect((await s.req('GET', '/conversations/director/messages?campaignId=khong-co')).status).toBe(400);
    // Chiến dịch của Workspace khác → 400.
    s.db.insert(workspaces).values({ id: 'W2', name: 'Khác', createdAt: T0, updatedAt: T0 }).run();
    s.db.insert(campaigns).values({ id: 'CX', workspaceId: 'W2', title: 'X', stages: ['research'], status: 'briefing', createdAt: T0, updatedAt: T0 }).run();
    expect((await s.req('POST', '/conversations/director/messages', { content: 'x', campaignId: 'CX' })).status).toBe(400);
    expect((await s.req('GET', '/conversations/director/messages?campaignId=CX')).status).toBe(400);
    expect(await texts(`?campaignId=${cid}`)).toEqual(['của A']);
  });

  it('xoá cùng bước, task, kết quả, yêu cầu duyệt; tin của chiến dịch bị xoá theo, tin chiến dịch khác giữ; xoá lần 2 → 404', async () => {
    const s = setup();
    const { cid } = await atChooseScript(s);
    await s.req('POST', '/conversations/director/messages', { content: 'về chiến dịch', campaignId: cid });
    const other = (await s.req('POST', '/campaigns', { title: 'Khác' })).body.id as string;
    await s.req('POST', '/conversations/director/messages', { content: 'của chiến dịch khác', campaignId: other });
    const r = await s.req('DELETE', `/campaigns/${cid}`, {});
    expect(r.status).toBe(200);
    expect(s.db.select().from(campaigns).where(eq(campaigns.id, cid)).get()).toBeUndefined();
    expect(s.db.select().from(campaignStages).where(eq(campaignStages.campaignId, cid)).all()).toHaveLength(0);
    expect(s.db.select().from(artifacts).where(eq(artifacts.campaignId, cid)).all()).toHaveLength(0);
    expect(s.db.select().from(approvals).where(eq(approvals.id, 'AP1')).get()).toBeUndefined();
    expect(s.db.select().from(messages).where(eq(messages.content, 'về chiến dịch')).all()).toHaveLength(0);
    expect(s.db.select().from(messages).where(isNull(messages.campaignId)).all().filter((m) => m.content === 'về chiến dịch')).toHaveLength(0);
    expect((await s.req('GET', `/conversations/director/messages?campaignId=${other}`)).body.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['agent', expect.stringContaining('"Khác"')],
      ['user', 'của chiến dịch khác'],
    ]);
    expect((await s.req('DELETE', `/campaigns/${cid}`, {})).status).toBe(404);
  });

  it('đang có lượt chạy CLI cho chiến dịch → 409, không xoá gì', async () => {
    const s = setup();
    const { cid } = await atChooseScript(s);
    s.db.insert(cliRuns).values({ id: 'R1', agentId: s.ids.researcher, campaignId: cid, provider: 'claude', model: 'm', purpose: 'task', startedAt: T0 }).run();
    expect((await s.req('DELETE', `/campaigns/${cid}`, {})).status).toBe(409);
    expect(s.db.select().from(campaigns).where(eq(campaigns.id, cid)).get()).toBeDefined();
  });
});

describe('tắt server', () => {
  it('POST /shutdown chỉ có khi được bật; gọi onShutdown sau khi trả lời', async () => {
    const { db } = minimal();
    const deps = { db, bus: new EventBus() };
    expect((await createApp(deps).request('/shutdown', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    let called = false;
    const app = createApp(deps, { onShutdown: () => (called = true) });
    const res = await app.request('/shutdown', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(called).toBe(true);
  });
});

describe('quyết định chọn kịch bản', () => {
  it('chọn 1 kịch bản → 200, chuyển sang bước video', async () => {
    const s = setup();
    const { cid, ids } = await atChooseScript(s);
    const pending = (await s.req('GET', '/approvals?status=pending')).body;
    expect(pending.map((a: { id: string }) => a.id)).toEqual(['AP1']);
    // Kèm nội dung kịch bản theo đúng thứ tự đề xuất, để giao diện hiện kịch bản thay vì mã.
    expect(pending[0].artifacts).toEqual(ids.map((id) => ({ id, kind: 'script', content: { text: id } })));
    const r = await s.req('POST', '/approvals/AP1/decide', { status: 'approved', decision: { chosen: [ids[0]] } });
    expect(r.status).toBe(200);
    // Chiến dịch mới có bước video bắt buộc (Q-2): Duyệt chuyển sang làm video ở nơi mặc định.
    expect(s.db.select().from(campaigns).where(eq(campaigns.id, cid)).get()).toMatchObject({ status: 'active', currentStage: 'video' });
    expect(s.db.select().from(tasks).all().filter((t) => t.kind === 'video.prompt')).toHaveLength(1);
  });

  it('artifact lạ → 400; quyết lần 2 → 409; id lạ → 404; trạng thái lạ → 400', async () => {
    const s = setup();
    const { ids } = await atChooseScript(s);
    expect((await s.req('POST', '/approvals/AP1/decide', { status: 'approved', decision: { chosen: ['X'] } })).status).toBe(400);
    expect((await s.req('POST', '/approvals/AP1/decide', { status: 'bừa' })).status).toBe(400);
    expect((await s.req('POST', '/approvals/AP1/decide', { status: 'approved', decision: { chosen: [ids[0]] } })).status).toBe(200);
    expect((await s.req('POST', '/approvals/AP1/decide', { status: 'approved', decision: { chosen: [ids[0]] } })).status).toBe(409);
    expect((await s.req('POST', '/approvals/khong-co/decide', { status: 'approved' })).status).toBe(404);
  });
});

describe('quyền ngoài phạm vi', () => {
  it('cấp hẳn năng lực → Agent có năng lực, lời gọi được chạy lại', async () => {
    const s = setup();
    s.db.update(agents).set({ permissions: [] }).where(eq(agents.id, s.ids.coordinator)).run();
    s.db.insert(approvals)
      .values({
        id: 'AP2',
        workspaceId: s.ids.workspace,
        campaignId: s.ids.campaign,
        kind: 'out_of_permission',
        subject: { tool: 'task_create', arguments: { kind: 'research.audience', title: 'Khách hàng', instructions: 'Tìm', assignee_name: 'An' }, agentId: s.ids.coordinator, capability: 'task.manage' },
        requestedByAgentId: s.ids.coordinator,
        status: 'pending',
        createdAt: T0,
        updatedAt: T0,
      })
      .run();
    const r = await s.req('POST', '/approvals/AP2/decide', { status: 'approved', decision: { grant: 'permanent' } });
    expect(r.status).toBe(200);
    expect(s.db.select().from(agents).where(eq(agents.id, s.ids.coordinator)).get()?.permissions).toContain('task.manage');
    expect(s.db.select().from(tasks).all().some((t) => t.kind === 'research.audience')).toBe(true);
  });

  it('cho phép một lần → chạy lại nhưng không cấp năng lực', async () => {
    const s = setup();
    s.db.update(agents).set({ permissions: [] }).where(eq(agents.id, s.ids.coordinator)).run();
    s.db.insert(approvals)
      .values({
        id: 'AP3',
        workspaceId: s.ids.workspace,
        campaignId: s.ids.campaign,
        kind: 'out_of_permission',
        subject: { tool: 'task_create', arguments: { kind: 'research.audience', title: 'K', instructions: 'T' }, agentId: s.ids.coordinator, capability: 'task.manage' },
        requestedByAgentId: s.ids.coordinator,
        status: 'pending',
        createdAt: T0,
        updatedAt: T0,
      })
      .run();
    expect((await s.req('POST', '/approvals/AP3/decide', { status: 'approved', decision: { grant: 'once' } })).status).toBe(200);
    expect(s.db.select().from(agents).where(eq(agents.id, s.ids.coordinator)).get()?.permissions).toEqual([]);
    expect(s.db.select().from(tasks).all().some((t) => t.kind === 'research.audience')).toBe(true);
  });
});

describe('chống trang web khác gọi API cục bộ (CSRF, DNS rebinding)', () => {
  it('Origin lạ → 403; text/plain → 415; Host lạ → 403', async () => {
    const s = setup();
    const app = createApp(s.deps);
    const cid = (await s.req('POST', '/campaigns', { title: 'A' })).body.id as string;
    const post = (headers: Record<string, string>) => app.request('/conversations/director/messages', { method: 'POST', body: JSON.stringify({ content: 'x', campaignId: cid }), headers });
    expect((await post({ 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await app.request('http://evil.example/snapshot')).status).toBe(403);
    expect((await post({ 'content-type': 'application/json', origin: 'http://localhost:5173' })).status).toBe(201);
  });
});

describe('chạy lại lời gọi đã duyệt vẫn qua kiểm phạm vi', () => {
  it('task_create cũ khi bước đã chuyển → không tạo task, báo Director', async () => {
    const s = setup();
    s.db.update(agents).set({ permissions: [] }).where(eq(agents.id, s.ids.coordinator)).run();
    s.db.update(campaigns).set({ currentStage: 'scripting' }).where(eq(campaigns.id, s.ids.campaign)).run();
    s.db.insert(approvals)
      .values({
        id: 'AP4',
        workspaceId: s.ids.workspace,
        campaignId: s.ids.campaign,
        kind: 'out_of_permission',
        subject: { tool: 'task_create', arguments: { kind: 'research.trend', title: 'Cũ', instructions: 'x' }, agentId: s.ids.coordinator, capability: 'task.manage' },
        requestedByAgentId: s.ids.coordinator,
        status: 'pending',
        createdAt: T0,
        updatedAt: T0,
      })
      .run();
    expect((await s.req('POST', '/approvals/AP4/decide', { status: 'approved', decision: { grant: 'once' } })).status).toBe(200);
    expect(s.db.select().from(tasks).all().filter((t) => t.input.title === 'Cũ')).toHaveLength(0);
  });
});

describe('mở khoá provider', () => {
  it('sau overage, người dùng mở khoá được', async () => {
    const s = setup();
    runTx(s.deps, (u) => blockForOverage(u, s.ids.workspace, 'claude'));
    expect((await s.req('POST', '/providers/claude/unblock')).status).toBe(200);
    expect(isProviderBlocked(s.db, 'claude', T0 + 10)).toBe(false);
  });

  it('GET /providers phản ánh trạng thái chặn trước và sau khi mở khoá', async () => {
    const s = setup();
    runTx(s.deps, (u) => blockForOverage(u, s.ids.workspace, 'claude'));
    const before = (await s.req('GET', '/providers')).body as Array<Record<string, unknown>>;
    const claude = before.find((p) => p.provider === 'claude');
    expect(claude).toMatchObject({ blockReason: 'overage' });
    expect(claude!.blockedUntil as number).toBeGreaterThan(T0);
    expect(Object.keys(claude!)).toEqual(expect.arrayContaining(['utilization5h', 'utilization7d', 'resetsAt']));
    await s.req('POST', '/providers/claude/unblock');
    const after = (await s.req('GET', '/providers')).body as Array<Record<string, unknown>>;
    expect(after.find((p) => p.provider === 'claude')).toMatchObject({ blockedUntil: null, blockReason: null });
  });
});

describe('GET /notices/system', () => {
  it('chỉ trả tin role system không gắn chiến dịch, mới nhất trước, tôn trọng limit', async () => {
    const s = setup();
    const { body: c } = await s.req('POST', '/campaigns', { title: 'Bông Bông' });
    // Mỗi tin một giao dịch: đồng hồ giả tăng dần nên createdAt khác nhau, thứ tự không phụ thuộc ULID.
    runTx(s.deps, (u) => notifyDirector(u, s.ids.workspace, 'Hệ thống 1'));
    runTx(s.deps, (u) => notifyDirector(u, s.ids.workspace, 'Gắn chiến dịch', c.id));
    runTx(s.deps, (u) => notifyDirector(u, s.ids.workspace, 'Hệ thống 2'));
    s.db.insert(messages).values({ id: 'MU', conversationId: s.db.select().from(conversations).where(isNull(conversations.agentId)).get()!.id, role: 'user', content: 'user không campaign', kind: 'chat', createdAt: T0 + 9_000_000 }).run();
    const r = await s.req('GET', '/notices/system');
    expect(r.status).toBe(200);
    expect(r.body.map((m: { content: string }) => m.content)).toEqual(['Hệ thống 2', 'Hệ thống 1']);
    expect(r.body[0]).toEqual({ id: expect.any(String), content: 'Hệ thống 2', createdAt: expect.any(Number) });
    expect((await s.req('GET', '/notices/system?limit=1')).body).toHaveLength(1);
  });
});
