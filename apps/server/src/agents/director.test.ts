import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../campaign/engine.ts';
import { EventBus } from '../core/bus.ts';
import { runTx } from '../core/unitOfWork.ts';
import { campaignStages, campaigns, cliRuns, messages, tasks } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { Gateway } from './gateway.ts';
import type { HarnessResult, HarnessSpec } from './harness.ts';
import { Runtime } from './runtime.ts';

const ok = (): HarnessResult => ({ outcome: 'ok', exitCode: 0, durationMs: 5, denials: 0, rateLimits: [] });
type Script = (spec: HarnessSpec, call: (name: string, args: Record<string, unknown>) => any) => HarnessResult | Promise<HarnessResult>;

function setup(script: Script) {
  const { db, ids } = minimal();
  // Campaign của fixture không theo luật 5 bước; đóng nó để không ảnh hưởng.
  db.update(campaigns).set({ status: 'completed' }).where(eq(campaigns.id, ids.campaign)).run();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => ++now };
  const gateway = new Gateway(deps);
  const specs: HarnessSpec[] = [];
  const results: any[] = [];
  const runtime = new Runtime(deps, gateway, {
    harness: async (spec) => {
      specs.push(spec);
      return script(spec, (name, args) => {
        const r = gateway.handle(spec.token, { method: 'tools/call', params: { name, arguments: args } });
        results.push(r);
        return r;
      });
    },
    backendUrl: () => 'http://127.0.0.1:1',
    logDir: mkdtempSync(join(tmpdir(), 'dele-dir-')),
    clock: () => now,
  });
  const newCampaign = () => runTx(deps, (u) => createCampaign(u, ids.workspace, 'Bông Bông'));
  const say = (content: string, campaignId?: string) => db.insert(messages).values({ id: `M${++now}`, conversationId: ids.conversation, role: 'user', content, campaignId, kind: 'chat', createdAt: now }).run();
  const camp = (id: string) => db.select().from(campaigns).where(eq(campaigns.id, id)).get()!;
  const tools = (spec: HarnessSpec) => gateway.handle(spec.token, { method: 'tools/list' }) as { tools: { name: string }[] };
  return { db, ids, runtime, specs, results, newCampaign, say, camp, tools, gateway };
}
const BRIEF = { goal: 'Tăng nhận diện', audience: 'Sinh viên 18–25', product: 'Trà sữa đường đen', platforms: ['tiktok'] };

describe('Director làm rõ brief và bàn giao', () => {
  it('tin người dùng → lượt briefing; đủ brief → bàn giao, trả lời', async () => {
    let listed: string[] = [];
    const s = setup((spec, call) => {
      listed = (s.tools(spec).tools ?? []).map((t) => t.name);
      call('campaign_update_brief', { campaign_id: cid, ...BRIEF });
      call('campaign_handoff', { campaign_id: cid });
      call('user_reply', { text: 'Đã rõ, em giao cho Minh.' });
      return ok();
    });
    const cid = s.newCampaign();
    s.say('Làm chiến dịch TikTok cho trà sữa, khách là sinh viên.', cid);
    expect(s.runtime.tick()).toHaveLength(1);
    await s.runtime.idle();
    expect(listed).toEqual(['user_reply', 'user_ask', 'campaign_update_brief', 'campaign_handoff']);
    expect(s.db.select().from(cliRuns).get()?.purpose).toBe('briefing');
    expect(s.camp(cid)).toMatchObject({ status: 'active', currentStage: 'research' });
    expect(s.db.select().from(messages).all().at(-1)).toMatchObject({ role: 'agent', content: 'Đã rõ, em giao cho Minh.' });
  });

  it('brief thiếu → bàn giao bị từ chối; brief không đổi được sau khi active', async () => {
    const s = setup((_spec, call) => {
      call('campaign_handoff', { campaign_id: cid });
      return ok();
    });
    const cid = s.newCampaign();
    s.say('Làm chiến dịch', cid);
    s.runtime.tick();
    await s.runtime.idle();
    expect(s.results[0].isError).toBe(true);
    expect(s.camp(cid).status).toBe('briefing');
    s.db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, cid)).run();
    const b = s.gateway.register({ runId: 'R', agentId: s.ids.director, workspaceId: s.ids.workspace, purpose: 'briefing' });
    const r = s.gateway.handle(b.token, { method: 'tools/call', params: { name: 'campaign_update_brief', arguments: { campaign_id: cid, goal: 'x' } } }) as { isError?: boolean };
    expect(r.isError).toBe(true);
  });

  it('user_ask → Director chờ người dùng trả lời', async () => {
    const s = setup((_spec, call) => {
      call('user_ask', { question: 'Đối tượng là ai ạ?' });
      return ok();
    });
    s.say('Chào', s.newCampaign());
    s.runtime.tick();
    await s.runtime.idle();
    expect(s.db.select().from(messages).all().at(-1)).toMatchObject({ kind: 'question' });
  });

  it('Director đang chạy + tin mới → không chạy lượt thứ hai', () => {
    const s = setup(() => new Promise(() => {}));
    const cid = s.newCampaign();
    s.say('Tin 1', cid);
    expect(s.runtime.tick()).toHaveLength(1);
    s.say('Tin 2', cid);
    expect(s.runtime.tick()).toHaveLength(0);
  });

  it('tin gửi lúc Director đang chạy → được xử lý ở lượt sau, kể cả khi Director đã trả lời tin trước', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    const s = setup(async (_spec, call) => {
      runs++;
      if (runs === 1) await gate;
      call('user_reply', { text: `Trả lời ${runs}` });
      return ok();
    });
    const cid = s.newCampaign();
    s.say('Tin 1', cid);
    expect(s.runtime.tick()).toHaveLength(1);
    s.say('Tin 2', cid);
    release();
    await s.runtime.idle();
    expect(s.runtime.tick()).toHaveLength(1);
    await s.runtime.idle();
    expect(runs).toBe(2);
    expect(s.runtime.tick()).toHaveLength(0);
  });

  it('bàn giao lần 2 → từ chối', async () => {
    const s = setup((_spec, call) => {
      call('campaign_update_brief', { campaign_id: cid, ...BRIEF });
      call('campaign_handoff', { campaign_id: cid });
      call('campaign_handoff', { campaign_id: cid });
      return ok();
    });
    const cid = s.newCampaign();
    s.say('Làm đi', cid);
    s.runtime.tick();
    await s.runtime.idle();
    expect(s.results[1].isError).toBeFalsy();
    expect(s.results[2].isError).toBe(true);
  });

  it('không trả lời 2 lần cho cùng tin → không chạy lần 3', async () => {
    const s = setup(() => ok());
    s.say('Chào', s.newCampaign());
    for (let i = 0; i < 2; i++) {
      expect(s.runtime.tick()).toHaveLength(1);
      await s.runtime.idle();
    }
    expect(s.runtime.tick()).toHaveLength(0);
  });
});

describe('Coordinator lên kế hoạch', () => {
  function active(script: Script) {
    const s = setup(script);
    const cid = s.newCampaign();
    s.db.update(campaigns).set({ brief: BRIEF }).where(eq(campaigns.id, cid)).run();
    return { ...s, cid };
  }

  it('bước chạy chưa có task → lượt planning; tạo task → được giao', async () => {
    const s = active((spec, call) => {
      if (spec.prompt.includes('Bước Nghiên cứu')) {
        call('task_create', { kind: 'research.trend', title: 'Xu hướng', instructions: 'Tìm', assignee_name: 'An' });
        call('task_create', { kind: 'research.audience', title: 'Khách hàng', instructions: 'Tìm', assignee_name: 'An' });
      }
      return ok();
    });
    const { activateCampaign } = await import('../campaign/engine.ts');
    runTx({ db: s.db, bus: new EventBus() }, (u) => activateCampaign(u, s.cid, `agent:${s.ids.director}`));
    expect(s.runtime.tick()).toHaveLength(1);
    expect(s.tools(s.specs[0]!).tools.map((t) => t.name)).toEqual(['task_create']);
    await s.runtime.idle();
    expect(s.db.select().from(tasks).where(eq(tasks.campaignId, s.cid)).all()).toHaveLength(2);
    expect(s.runtime.tick()).toHaveLength(1); // An nhận task đầu
  });

  it('3 lượt planning rỗng → ngừng, báo Director', async () => {
    const s = active(() => ok());
    const { activateCampaign } = await import('../campaign/engine.ts');
    runTx({ db: s.db, bus: new EventBus() }, (u) => activateCampaign(u, s.cid, `agent:${s.ids.director}`));
    for (let i = 0; i < 3; i++) {
      expect(s.runtime.tick()).toHaveLength(1);
      await s.runtime.idle();
    }
    expect(s.runtime.tick()).toHaveLength(0);
    expect(s.db.select().from(messages).all().some((m) => m.role === 'system' && m.content.includes('kế hoạch'))).toBe(true);
  });

  it('kịch bản thứ 4 trong một vòng → từ chối', () => {
    const s = setup(() => ok());
    const cid = s.newCampaign();
    s.db.update(campaigns).set({ status: 'active', currentStage: 'scripting' }).where(eq(campaigns.id, cid)).run();
    s.db.update(campaignStages).set({ status: 'running', startedAt: T0 }).where(and(eq(campaignStages.campaignId, cid), eq(campaignStages.stage, 'scripting'))).run();
    const b = s.gateway.register({ runId: 'R', agentId: s.ids.coordinator, workspaceId: s.ids.workspace, campaignId: cid, purpose: 'planning' });
    const create = () =>
      s.gateway.handle(b.token, { method: 'tools/call', params: { name: 'task_create', arguments: { kind: 'script', title: 'KB', instructions: 'Viết', assignee_name: 'Hà' } } }) as { isError?: boolean };
    for (let i = 0; i < 3; i++) expect(create().isError).toBeFalsy();
    expect(create().isError).toBe(true);
  });
});

describe('Director theo luồng chat của chiến dịch', () => {
  const byThread = (s: ReturnType<typeof setup>, campaignId: string | null) =>
    s.db.select().from(messages).all().filter((m) => m.campaignId === campaignId);

  it('trả lời tin ở chiến dịch X → tin agent gắn X; prompt không lẫn chiến dịch khác', async () => {
    const s = setup((_spec, call) => {
      call('user_reply', { text: 'ok' });
      return ok();
    });
    const a = s.newCampaign();
    const b = runTx({ db: s.db, bus: new EventBus(), clock: () => 1 }, (u) => createCampaign(u, s.ids.workspace, 'Trà Đào Cam'));
    s.say('tin của A', a);
    s.say('tin của B', b);
    for (let i = 0; i < 2; i++) {
      expect(s.runtime.tick()).toHaveLength(1);
      await s.runtime.idle();
    }
    expect(s.runtime.tick()).toHaveLength(0);
    for (const id of [a, b]) expect(byThread(s, id).map((m) => m.role)).toEqual(['user', 'agent']);

    const prompts = Object.fromEntries(s.specs.map((sp) => [sp.prompt.includes('tin của A') ? 'A' : 'B', sp.prompt]));
    expect(prompts.A).toContain('tin của A');
    expect(prompts.A).not.toContain('tin của B');
    expect(prompts.A).not.toContain(b);
    expect(prompts.A).not.toContain('Trà Đào Cam');
    expect(prompts.B).not.toContain(a);
  });

  it('lượt chạy gắn đúng chiến dịch; chiến dịch briefing → briefing; gateway từ chối campaign_id khác', async () => {
    let other = '';
    const s = setup((spec, call) => {
      if (spec.prompt.includes('đang làm rõ brief')) {
        call('campaign_update_brief', { campaign_id: other, goal: 'sai chỗ' });
        call('campaign_handoff', { campaign_id: other });
      }
      call('user_reply', { text: 'ok' });
      return ok();
    });
    const a = s.newCampaign();
    other = s.newCampaign();
    s.say('brief A', a);
    s.runtime.tick();
    await s.runtime.idle();
    const runs = s.db.select().from(cliRuns).all();
    expect(runs.map((r) => [r.purpose, r.campaignId])).toEqual([['briefing', a]]);
    expect(s.results.slice(0, 2).map((r) => r.isError)).toEqual([true, true]);
    expect(s.camp(other)).toMatchObject({ status: 'briefing', brief: {} });
  });

  it('tin user campaignId null (kể cả chưa trả lời, có/không cli_runs null cũ) → không bao giờ chạy lượt Director', async () => {
    const s = setup(() => ok());
    s.say('tin cũ ở Chung');
    expect(s.runtime.tick()).toHaveLength(0);
    // Có lượt chạy cũ campaignId null, bắt đầu trước tin mới.
    s.db.insert(cliRuns).values({ id: 'RUN-OLD', agentId: s.ids.director, provider: 'claude', model: 'sonnet', purpose: 'chat', startedAt: T0 - 5, endedAt: T0 - 4 }).run();
    s.say('tin cũ thứ hai ở Chung');
    for (let i = 0; i < 3; i++) {
      expect(s.runtime.tick()).toHaveLength(0);
      await s.runtime.idle();
    }
    expect(s.specs).toHaveLength(0);
    expect(s.db.select().from(cliRuns).all().map((r) => r.id)).toEqual(['RUN-OLD']);
    // Tin chờ ở chiến dịch vẫn chạy, gắn đúng chiến dịch, không đụng tin null.
    const cid = s.newCampaign();
    s.say('tin của chiến dịch', cid);
    expect(s.runtime.tick()).toHaveLength(1);
    await s.runtime.idle();
    expect(s.db.select().from(cliRuns).all().filter((r) => r.id !== 'RUN-OLD').map((r) => r.campaignId)).toEqual([cid]);
    expect(s.specs[0]!.prompt).not.toContain('tin cũ');
    expect(byThread(s, null).every((m) => m.role === 'user')).toBe(true);
  });

  it('campaign_create đã bỏ: không có trong tools/list của purpose nào, gọi bị từ chối; user_reply/user_ask không gắn chiến dịch lỗi', () => {
    const s = setup(() => ok());
    for (const purpose of ['chat', 'briefing', 'planning', 'task', 'review'] as const) {
      const b = s.gateway.register({ runId: `R-${purpose}`, agentId: s.ids.director, workspaceId: s.ids.workspace, purpose });
      expect((s.gateway.handle(b.token, { method: 'tools/list' }) as { tools: { name: string }[] }).tools.map((t) => t.name)).not.toContain('campaign_create');
    }
    const chat = s.gateway.register({ runId: 'R-chat2', agentId: s.ids.director, workspaceId: s.ids.workspace, purpose: 'chat', conversationId: s.ids.conversation });
    const call = (name: string, args: Record<string, unknown>) => s.gateway.handle(chat.token, { method: 'tools/call', params: { name, arguments: args } }) as { isError?: boolean };
    expect(call('campaign_create', { title: 'Lạc đường' }).isError).toBe(true);
    expect(s.db.select().from(campaigns).all().filter((c) => c.title === 'Lạc đường')).toHaveLength(0);
    expect(call('user_reply', { text: 'x' }).isError).toBe(true);
    expect(call('user_ask', { question: 'x?' }).isError).toBe(true);
    expect(s.db.select().from(messages).all()).toHaveLength(0);
  });

  it('lịch: hai luồng cùng có tin chờ chạy lần lượt; mỗi tin tối đa 2 lượt; tin gửi lúc đang chạy không bị bỏ sót', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const s = setup(async (spec) => {
      if (first) {
        first = false;
        await gate;
      }
      return ok();
    });
    const a = s.newCampaign();
    const b = s.newCampaign();
    // Nhận diện lượt chạy theo id chiến dịch và nội dung chữ thường: prompt chứa ULID ngẫu nhiên (chữ hoa + số) nên các chuỗi
    // kiểu 'A1'/'B1' có thể trùng ngẫu nhiên với một đoạn của id (lỗi chập chờn trước đây).
    s.say('tin-a1', a);
    s.say('tin-b1', b);
    expect(s.runtime.tick()).toHaveLength(1);
    expect(s.runtime.tick()).toHaveLength(0);
    s.say('tin-a2', a);
    release();
    await s.runtime.idle();
    // Luồng B (tin chờ lâu nhất) rồi tới A (có tin A2 mới hơn lượt đã chạy).
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      const started = s.runtime.tick();
      if (started.length === 0) break;
      expect(started).toHaveLength(1);
      const prompt = s.specs.at(-1)!.prompt;
      order.push(prompt.includes(`- ${b} "`) ? 'B' : prompt.includes(`- ${a} "`) ? 'A' : '?');
      await s.runtime.idle();
    }
    expect(s.specs[0]!.prompt).toContain('tin-a1');
    expect(s.specs[0]!.prompt).not.toContain('tin-b1');
    expect(order).toEqual(['B', 'B', 'A', 'A']);
    expect(s.specs).toHaveLength(5);
  });
});
