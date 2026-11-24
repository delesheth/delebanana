// Bảng chuyển kỳ vọng chép từ docs/design/02-lifecycle-events.md mục 4. Kiểm cả hai chiều:
// mọi dòng trong bảng phải hợp lệ, mọi cặp ngoài bảng phải bị từ chối với cả ba loại tác nhân.

import { describe, expect, it } from 'vitest';
import { checkTransition, nextStates, type Actor, type ActorKind, type Machine } from '../machine.ts';
import {
  APPROVAL_KINDS,
  MAX_ATTEMPTS,
  MAX_PUBLISH_RETRIES,
  STAGE_GATE,
  STAGE_ORDER,
  approvalMachine,
  campaignMachine,
  isBriefComplete,
  needsReview,
  reviewOutcome,
  postMachine,
  stageMachine,
  taskMachine,
  videoVersionMachine,
} from './index.ts';

type Row = [from: string, to: string, by: ActorKind[]];
const ACTOR: Record<ActorKind, Actor> = { user: 'user', system: 'system', agent: 'agent:x' };
const ALL: ActorKind[] = ['user', 'system', 'agent'];

const fullBrief = { goal: 'tăng nhận diện', audience: 'Gen Z', product: 'trà sữa', platforms: ['tiktok' as const] };

function exhaustive<C>(m: Machine<string, C>, rows: Row[], ctx: C, terminal: string[]) {
  describe(m.name, () => {
    it('mọi đường chuyển trong bảng hợp lệ với đúng tác nhân', () => {
      for (const [from, to, by] of rows) {
        for (const a of ALL) {
          const r = checkTransition(m, from, to, ACTOR[a], ctx);
          expect({ from, to, a, ok: r.ok }).toEqual({ from, to, a, ok: by.includes(a) });
        }
      }
    });

    it('mọi cặp ngoài bảng bị từ chối', () => {
      const declared = new Set(rows.map(([f, t]) => `${f}>${t}`));
      for (const from of m.states)
        for (const to of m.states) {
          if (declared.has(`${from}>${to}`)) continue;
          for (const a of ALL) expect(checkTransition(m, from, to, ACTOR[a], ctx).ok, `${from} → ${to}`).toBe(false);
        }
    });

    it('trạng thái kết thúc không có đường ra', () => {
      expect([...m.terminal].sort()).toEqual([...terminal].sort());
      for (const s of terminal) expect(nextStates(m, s)).toEqual([]);
    });
  });
}

const S: ActorKind[] = ['system'];
const U: ActorKind[] = ['user'];
const A: ActorKind[] = ['agent'];

exhaustive(
  campaignMachine,
  [
    ['briefing', 'active', A],
    ['active', 'paused', U],
    ['paused', 'active', U],
    ['active', 'completed', S],
    ['briefing', 'cancelled', U],
    ['active', 'cancelled', U],
    ['paused', 'cancelled', U],
  ],
  { brief: fullBrief },
  ['completed', 'cancelled'],
);

exhaustive(
  stageMachine,
  [
    ['pending', 'running', S],
    ['pending', 'skipped', S],
    ['running', 'awaiting_approval', S],
    ['running', 'done', S],
    ['awaiting_approval', 'done', S],
    ['awaiting_approval', 'running', S],
  ],
  undefined,
  ['done', 'skipped'],
);

const taskRows = (attempt: number): Row[] => [
  ['queued', 'assigned', S],
  ['assigned', 'running', S],
  ['running', 'waiting', S],
  ['waiting', 'done', S],
  ['waiting', 'failed', S],
  ['running', 'in_review', S],
  ['running', 'done', S],
  ['in_review', 'done', A],
  ['in_review', 'queued', attempt < MAX_ATTEMPTS ? A : []],
  ['in_review', 'failed', attempt >= MAX_ATTEMPTS ? S : []],
  ['running', 'queued', S],
  ['running', 'failed', S],
  ['queued', 'cancelled', S],
  ['assigned', 'cancelled', S],
  ['running', 'cancelled', S],
  ['waiting', 'cancelled', S],
  ['in_review', 'cancelled', S],
];
exhaustive(taskMachine, taskRows(1), { attempt: 1 }, ['done', 'failed', 'cancelled']);
exhaustive(taskMachine, taskRows(MAX_ATTEMPTS), { attempt: MAX_ATTEMPTS }, ['done', 'failed', 'cancelled']);

exhaustive(
  videoVersionMachine,
  [
    ['requested', 'awaiting_upload', S],
    ['requested', 'rendering', S],
    ['awaiting_upload', 'ready', S],
    ['awaiting_upload', 'invalid', S],
    ['invalid', 'ready', S],
    ['rendering', 'ready', S],
    ['rendering', 'failed', S],
    ['ready', 'approved', S],
    ['ready', 'rejected', S],
  ],
  undefined,
  ['approved', 'rejected', 'failed'],
);

const postRows = (retries: number): Row[] => [
  ['draft', 'awaiting_approval', S],
  ['awaiting_approval', 'scheduled', S],
  ['awaiting_approval', 'publishing', S],
  ['scheduled', 'publishing', S],
  ['publishing', 'scheduled', S],
  ['publishing', 'published', S],
  ['scheduled', 'published', S],
  ['publishing', 'draft_uploaded', S],
  ['publishing', 'failed', S],
  ['failed', 'publishing', retries < MAX_PUBLISH_RETRIES ? ['system', 'user'] : U],
  ['draft', 'cancelled', ['user', 'system']],
  ['awaiting_approval', 'cancelled', ['user', 'system']],
  ['scheduled', 'cancelled', ['user', 'system']],
  ['failed', 'cancelled', ['user', 'system']],
];
exhaustive(postMachine, postRows(0), { retries: 0 }, ['published', 'draft_uploaded', 'cancelled']);
exhaustive(postMachine, postRows(MAX_PUBLISH_RETRIES), { retries: MAX_PUBLISH_RETRIES }, ['published', 'draft_uploaded', 'cancelled']);
// Bài đăng tay: người dùng được đánh dấu đã đăng (scheduled → published); mode api thì không.
exhaustive(
  postMachine,
  postRows(0).map((r): Row => (r[0] === 'scheduled' && r[1] === 'published' ? [r[0], r[1], [...S, ...U]] : r)),
  { retries: 0, mode: 'manual' },
  ['published', 'draft_uploaded', 'cancelled'],
);

exhaustive(
  approvalMachine,
  [
    ['pending', 'approved', U],
    ['pending', 'rejected', U],
    ['pending', 'changes_requested', U],
    ['pending', 'expired', S],
  ],
  undefined,
  ['approved', 'rejected', 'changes_requested', 'expired'],
);

describe('kết quả review', () => {
  it('pass và pass_with_limits kết thúc task; rework quay lại hàng đợi tới khi hết lượt', () => {
    expect(reviewOutcome('pass', 1)).toBe('done');
    expect(reviewOutcome('pass_with_limits', 1)).toBe('done');
    expect(reviewOutcome('rework', 1)).toBe('queued');
    expect(reviewOutcome('rework', MAX_ATTEMPTS)).toBe('failed');
  });
});

describe('loại Approval', () => {
  it('gồm strategy_change (TK3 mục 6)', () => {
    expect(APPROVAL_KINDS).toEqual([
      'choose_script',
      'make_video',
      'approve_video',
      'approve_publish',
      'strategy_change',
      'out_of_permission',
      'limit_override',
    ]);
  });
});

describe('brief', () => {
  it('đủ trường bắt buộc mới bàn giao được', () => {
    expect(isBriefComplete(fullBrief)).toBe(true);
    expect(isBriefComplete({ ...fullBrief, platforms: [] })).toBe(false);
    expect(isBriefComplete({ goal: 'a', audience: 'b', product: 'c' })).toBe(false);
    expect(isBriefComplete({ ...fullBrief, goal: '  ' })).toBe(false);
    const r = checkTransition(campaignMachine, 'briefing', 'active', 'agent:d', { brief: { goal: 'a' } });
    expect(r).toEqual({ ok: false, reason: 'brief thiếu trường bắt buộc' });
  });
});

describe('khung bước', () => {
  it('5 bước theo thứ tự cố định và điểm duyệt', () => {
    expect(STAGE_ORDER).toEqual(['research', 'scripting', 'video', 'publishing', 'analytics']);
    expect(STAGE_GATE).toEqual({ research: null, scripting: 'choose_script', video: 'approve_video', publishing: 'approve_publish', analytics: null });
  });

  it('việc Coordinator tự làm không cần Review', () => {
    expect(needsReview('research.synthesis')).toBe(false);
    expect(needsReview('planning')).toBe(false);
    expect(needsReview('script')).toBe(true);
    expect(needsReview('research.trend')).toBe(true);
  });
});
