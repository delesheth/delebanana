import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { agentFacts } from '../core/agentState.ts';
import { EventBus } from '../core/bus.ts';
import { runTx } from '../core/unitOfWork.ts';
import { messages, providerStatus } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { blockForOverage, blockForQuota, isProviderBlocked, notifyDirector, recordRateLimit, unblockProvider } from './usage.ts';

const MIN = 60_000;
const RESET_S = Math.floor((T0 + 60 * MIN) / 1000);

function setup() {
  const { db, ids } = minimal();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => now };
  const info = (u5: number) => ({ status: 'allowed', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: u5, resetsAt: RESET_S }, seven_day: { utilization: 0.1, resetsAt: RESET_S + 99999 } } });
  return { db, ids, deps, info, setNow: (t: number) => (now = t) };
}
const systemMsgs = (db: ReturnType<typeof setup>['db']) => db.select().from(messages).where(eq(messages.role, 'system')).all();

describe('recordRateLimit', () => {
  it('dưới 80%: không khoá, không cảnh báo', () => {
    const { db, ids, deps, info } = setup();
    runTx(deps, (u) => recordRateLimit(u, ids.workspace, 'claude', info(0.5)));
    expect(isProviderBlocked(db, 'claude', T0)).toBe(false);
    expect(systemMsgs(db)).toHaveLength(0);
    expect(db.select().from(providerStatus).get()?.utilization5h).toBe(0.5);
  });

  it('≥ 80%: cảnh báo một lần mỗi cửa sổ', () => {
    const { db, ids, deps, info } = setup();
    runTx(deps, (u) => recordRateLimit(u, ids.workspace, 'claude', info(0.82)));
    runTx(deps, (u) => recordRateLimit(u, ids.workspace, 'claude', info(0.85)));
    expect(systemMsgs(db)).toHaveLength(1);
    expect(systemMsgs(db)[0]!.content).toContain('82%');
  });

  it('≥ 95%: khoá tới lúc hồi lại, Agent dùng provider bị blocked', () => {
    const { db, ids, deps, info } = setup();
    runTx(deps, (u) => recordRateLimit(u, ids.workspace, 'claude', info(0.96)));
    expect(isProviderBlocked(db, 'claude', T0)).toBe(true);
    expect(agentFacts(db, ids.researcher, T0).blocked).toBe(true);
    expect(isProviderBlocked(db, 'claude', RESET_S * 1000 + 1)).toBe(false);
  });
});

describe('khoá provider', () => {
  it('hết hạn mức không có resetsAt: 15 rồi 30 phút', () => {
    const { db, deps } = setup();
    runTx(deps, (u) => blockForQuota(u, 'claude'));
    expect(db.select().from(providerStatus).get()?.blockedUntil).toBe(T0 + 15 * MIN);
    runTx(deps, (u) => blockForQuota(u, 'claude'));
    expect(db.select().from(providerStatus).get()?.blockedUntil).toBe(T0 + 30 * MIN);
  });

  it('có resetsAt thì khoá tới resetsAt', () => {
    const { db, deps } = setup();
    runTx(deps, (u) => blockForQuota(u, 'claude', T0 + 7 * MIN));
    expect(db.select().from(providerStatus).get()?.blockedUntil).toBe(T0 + 7 * MIN);
  });

  it('mức vượt có tính phí: khoá vô thời hạn và báo người dùng; mở khoá được', () => {
    const { db, ids, deps } = setup();
    runTx(deps, (u) => blockForOverage(u, ids.workspace, 'claude'));
    expect(isProviderBlocked(db, 'claude', T0 + 365 * 24 * 60 * MIN)).toBe(true);
    expect(db.select().from(providerStatus).get()?.blockReason).toBe('overage');
    expect(systemMsgs(db)).toHaveLength(1);
    runTx(deps, (u) => unblockProvider(u, 'claude'));
    expect(isProviderBlocked(db, 'claude', T0)).toBe(false);
  });
});

describe('notifyDirector', () => {
  it('tin về chiến dịch mang campaignId; tin hạn mức không gắn chiến dịch vẫn được ghi và phát message.created có data.text', () => {
    const { db, ids, deps, info } = setup();
    const events: { campaignId?: string; data: Record<string, unknown> }[] = [];
    deps.bus.subscribe((e: any) => e.type === 'message.created' && events.push(e));
    runTx(deps, (u) => notifyDirector(u, ids.workspace, 'về chiến dịch', ids.campaign));
    runTx(deps, (u) => recordRateLimit(u, ids.workspace, 'claude', info(0.9)));
    const rows = systemMsgs(db);
    expect(rows.find((m) => m.content === 'về chiến dịch')?.campaignId).toBe(ids.campaign);
    const loose = rows.filter((m) => m.content !== 'về chiến dịch');
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.every((m) => m.campaignId === null)).toBe(true);
    expect(events.find((e) => e.campaignId === ids.campaign)?.data.text).toBeUndefined();
    const texts = events.filter((e) => !e.campaignId).map((e) => e.data.text);
    expect(texts).toEqual(loose.map((m) => m.content));
  });
});
