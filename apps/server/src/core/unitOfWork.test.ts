import type { DomainEvent } from '@delebanana/domain';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { audit, events, tasks } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { EventBus } from './bus.ts';
import { runTx } from './unitOfWork.ts';

function setup() {
  const { db, ids } = minimal();
  const bus = new EventBus();
  const got: DomainEvent[] = [];
  bus.subscribe((e) => got.push(e));
  return { db, ids, bus, got, deps: { db, bus, clock: () => T0 + 1 } };
}

describe('transition', () => {
  it('đổi trạng thái, ghi sự kiện và nhật ký trong cùng giao dịch; phát sau commit', () => {
    const { db, ids, got, deps } = setup();
    const e = runTx(deps, (u) => {
      const ev = u.transition({ entity: 'task', id: ids.task, to: 'assigned', actor: 'system', ctx: { attempt: 1 } });
      expect(got.filter((x) => x.type === 'task.status_changed')).toHaveLength(0); // chưa commit
      return ev;
    });
    expect(db.select().from(tasks).where(eq(tasks.id, ids.task)).get()?.status).toBe('assigned');
    const rows = db.select().from(events).all().filter((r) => r.type === 'task.status_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ from: 'queued', to: 'assigned', attempt: 1 });
    expect(e).toMatchObject({ type: 'task.status_changed', entity: { kind: 'task', id: ids.task }, campaignId: ids.campaign });
    expect(db.select().from(audit).all().filter((a) => a.action === 'task.transition' && a.result === 'allowed')).toHaveLength(1);
    expect(got.filter((x) => x.type === 'task.status_changed')).toHaveLength(1);
  });

  it('đường chuyển sai: lỗi, không đổi dữ liệu, không sự kiện, nhật ký denied', () => {
    const { db, ids, got, deps } = setup();
    expect(() => runTx(deps, (u) => u.transition({ entity: 'task', id: ids.task, to: 'done', actor: 'system', ctx: { attempt: 1 } }))).toThrow(
      'không có đường chuyển',
    );
    expect(db.select().from(tasks).where(eq(tasks.id, ids.task)).get()?.status).toBe('queued');
    expect(db.select().from(events).all()).toHaveLength(0);
    expect(got).toHaveLength(0);
    const denied = db.select().from(audit).all().filter((a) => a.result === 'denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]!.reason).toContain('không có đường chuyển');
  });

  it('bị từ chối nhưng người gọi bắt lỗi và commit: vẫn ghi nhật ký denied', () => {
    const { db, ids, deps } = setup();
    runTx(deps, (u) => {
      try {
        u.transition({ entity: 'task', id: ids.task, to: 'done', actor: 'agent:x', ctx: { attempt: 1 } });
      } catch {
        // người gọi tự xử lý
      }
    });
    expect(db.select().from(audit).all().filter((a) => a.result === 'denied')).toHaveLength(1);
  });

  it('id không tồn tại: lỗi rõ ràng, không sự kiện', () => {
    const { db, deps } = setup();
    expect(() => runTx(deps, (u) => u.transition({ entity: 'task', id: 'X', to: 'assigned', actor: 'system', ctx: { attempt: 1 } }))).toThrow(
      'task X không tồn tại',
    );
    expect(db.select().from(events).all()).toHaveLength(0);
  });
});

describe('emit và runTx', () => {
  const ev = (ids: { workspace: string; campaign: string }) =>
    ({
      type: 'campaign.created',
      workspaceId: ids.workspace,
      campaignId: ids.campaign,
      entity: { kind: 'campaign', id: ids.campaign },
      actor: 'user',
      data: { title: 'Trà sữa' },
    }) as const;

  it('lỗi giữa giao dịch: không lưu, không phát', () => {
    const { db, ids, got, deps } = setup();
    expect(() =>
      runTx(deps, (u) => {
        u.emit(ev(ids));
        throw new Error('hỏng');
      }),
    ).toThrow('hỏng');
    expect(db.select().from(events).all()).toHaveLength(0);
    expect(got).toHaveLength(0);
  });

  it('nhiều emit: seq liên tiếp, phát theo thứ tự', () => {
    const { ids, got, deps } = setup();
    runTx(deps, (u) => {
      u.emit(ev(ids));
      u.emit({ ...ev(ids), data: { title: 'Lần 2' } });
    });
    expect(got.map((e) => e.seq)).toEqual([got[0]!.seq, got[0]!.seq + 1]);
    expect(got[1]!.data).toEqual({ title: 'Lần 2' });
  });

  it('audit che bí mật trong details', () => {
    const { db, ids, deps } = setup();
    runTx(deps, (u) => u.audit({ workspaceId: ids.workspace, actor: 'user', action: 'oauth.connect', result: 'allowed', details: { accessToken: 'abc', platform: 'tiktok' } }));
    expect(db.select().from(audit).all()[0]!.details).toEqual({ accessToken: '[đã che]', platform: 'tiktok' });
  });
});
