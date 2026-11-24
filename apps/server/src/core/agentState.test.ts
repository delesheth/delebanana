import type { DomainEvent } from '@delebanana/domain';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { agents, cliRuns, messages } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { agentFacts, recomputeAgents } from './agentState.ts';
import { EventBus } from './bus.ts';
import { runTx } from './unitOfWork.ts';

function setup() {
  const { db, ids } = minimal();
  const bus = new EventBus();
  const got: DomainEvent[] = [];
  bus.subscribe((e) => got.push(e));
  let t = T0;
  return { db, ids, got, deps: { db, bus, clock: () => ++t } };
}
const states = (got: DomainEvent[]) => got.filter((e) => e.type === 'agent.state_changed');

describe('recomputeAgents', () => {
  it('task được giao → phát agent.state_changed assigned cho người được giao', () => {
    const { db, ids, got, deps } = setup();
    runTx(deps, (u) => u.transition({ entity: 'task', id: ids.task, to: 'assigned', actor: 'system', ctx: { attempt: 1 } }));
    const s = states(got);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ entity: { kind: 'agent', id: ids.researcher }, data: { state: 'assigned', taskId: ids.task } });
    expect(db.select().from(agents).where(eq(agents.id, ids.researcher)).get()?.lastState).toBe('assigned');
  });

  it('tính lại khi không có gì đổi → không phát sự kiện mới', () => {
    const { ids, got, deps } = setup();
    runTx(deps, (u) => recomputeAgents(u, [ids.researcher]));
    const before = states(got).length;
    runTx(deps, (u) => recomputeAgents(u, [ids.researcher]));
    expect(states(got)).toHaveLength(before);
  });
});

describe('agentFacts', () => {
  it('lượt CLI đang mở → activeRun và trạng thái researching', () => {
    const { db, ids, got, deps } = setup();
    db.insert(cliRuns).values({ id: 'R1', agentId: ids.researcher, taskId: ids.task, provider: 'claude', model: 'sonnet', purpose: 'task', startedAt: T0 }).run();
    expect(agentFacts(db, ids.researcher).activeRun).toEqual({ purpose: 'task', taskKind: 'research.trend' });
    runTx(deps, (u) => recomputeAgents(u, [ids.researcher]));
    expect(states(got).at(-1)?.data).toMatchObject({ state: 'researching' });
  });

  it('Director hỏi người dùng → awaitingUserReply cho tới khi có trả lời', () => {
    const { db, ids } = setup();
    db.insert(messages).values({ id: 'M1', conversationId: ids.conversation, role: 'agent', agentId: ids.director, campaignId: ids.campaign, content: 'Đối tượng là ai?', kind: 'question', createdAt: T0 + 10 }).run();
    expect(agentFacts(db, ids.director).awaitingUserReply).toBe(true);
    db.insert(messages).values({ id: 'M2', conversationId: ids.conversation, role: 'user', campaignId: ids.campaign, content: 'Sinh viên', kind: 'chat', createdAt: T0 + 20 }).run();
    expect(agentFacts(db, ids.director).awaitingUserReply).toBe(false);
  });

  it('Agent bị tắt → offline', () => {
    const { db, ids, got, deps } = setup();
    db.update(agents).set({ enabled: false }).where(eq(agents.id, ids.researcher)).run();
    runTx(deps, (u) => recomputeAgents(u, [ids.researcher]));
    expect(states(got).at(-1)?.data).toMatchObject({ state: 'offline' });
  });
});

describe('awaitingUserReply theo luồng chat', () => {
  it('câu hỏi ở luồng chiến dịch vẫn bật khi người dùng nhắn ở luồng khác; tắt khi trả lời đúng luồng', () => {
    const { db, ids } = setup();
    let at = T0;
    const msg = (role: string, campaignId: string | null, kind = 'chat') =>
      db.insert(messages).values({ id: `M${++at}`, conversationId: ids.conversation, role, agentId: role === 'agent' ? ids.director : null, campaignId, content: 'x', kind, createdAt: at }).run();
    msg('agent', ids.campaign, 'question');
    expect(agentFacts(db, ids.director).awaitingUserReply).toBe(true);
    msg('user', null);
    expect(agentFacts(db, ids.director).awaitingUserReply).toBe(true);
    msg('user', ids.campaign);
    expect(agentFacts(db, ids.director).awaitingUserReply).toBe(false);
  });
});

describe('awaitingUserReply bỏ qua tin không gắn chiến dịch', () => {
  it('câu hỏi cũ của Director ở campaignId null không làm Director ở trạng thái chờ', () => {
    const { db, ids } = setup();
    db.insert(messages).values({ id: 'MQ', conversationId: ids.conversation, role: 'agent', agentId: ids.director, campaignId: null, content: 'cũ?', kind: 'question', createdAt: T0 + 1 }).run();
    expect(agentFacts(db, ids.director).awaitingUserReply).toBe(false);
  });
});
