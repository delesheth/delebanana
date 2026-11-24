import type { CampaignDetail } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import { chosenScripts, nextAction, stepsOf } from './campaignView.ts';

function detail(over: { status?: string; currentStage?: string; stages?: [string, string][]; approvals?: unknown[]; tasks?: unknown[] }): CampaignDetail {
  return {
    campaign: { id: 'c', title: 'iPad', status: over.status ?? 'active', currentStage: over.currentStage ?? 'research' },
    stages: (over.stages ?? [['research', 'running'], ['scripting', 'pending'], ['video', 'skipped']]).map(([stage, status]) => ({ stage, status })),
    tasks: over.tasks ?? [],
    artifacts: [
      { id: 'S1', kind: 'script', content: { text: 'A' } },
      { id: 'S2', kind: 'script', content: { text: 'B' } },
    ],
    approvals: over.approvals ?? [],
  } as unknown as CampaignDetail;
}

describe('diễn giải Campaign cho người dùng', () => {
  it('bước bị bỏ qua không hiện; trạng thái dịch sang lời', () => {
    const steps = stepsOf(detail({ stages: [['research', 'done'], ['scripting', 'awaiting_approval'], ['video', 'skipped']] }));
    expect(steps.map((s) => [s.label, s.state])).toEqual([
      ['Nghiên cứu thị trường', 'done'],
      ['Viết kịch bản', 'waiting_you'],
    ]);
  });

  it('bước video: pending thì ẩn, đang chờ làm video thì nhắc mở mục duyệt', () => {
    expect(stepsOf(detail({ stages: [['research', 'done'], ['scripting', 'done'], ['video', 'pending']] })).map((s) => s.stage)).toEqual(['research', 'scripting']);
    const d = detail({ currentStage: 'video', stages: [['research', 'done'], ['scripting', 'done'], ['video', 'awaiting_approval']] });
    expect(stepsOf(d).map((s) => s.stage)).toContain('video');
    expect(nextAction(d)).toMatchObject({ kind: 'approve' });
    expect(nextAction(d).text).toContain('Prompt video');
  });

  it('việc tiếp theo theo từng giai đoạn', () => {
    expect(nextAction(detail({ status: 'briefing' })).kind).toBe('chat');
    const tasks = [{ stage: 'research', status: 'done' }, { stage: 'research', status: 'running' }];
    expect(nextAction(detail({ tasks })).text).toContain('1/2 việc xong');
    expect(nextAction(detail({ currentStage: 'scripting', stages: [['research', 'done'], ['scripting', 'awaiting_approval']] })).kind).toBe('approve');
    const rewrite = detail({ currentStage: 'scripting', stages: [['research', 'done'], ['scripting', 'running']], approvals: [{ kind: 'choose_script', status: 'changes_requested' }] });
    expect(nextAction(rewrite).text).toContain('viết lại');
    expect(nextAction(detail({ status: 'completed' })).kind).toBe('done');
  });

  it('kịch bản đã chọn lấy từ lần duyệt gần nhất', () => {
    const d = detail({ status: 'completed', approvals: [{ kind: 'choose_script', status: 'approved', decision: { chosen: ['S2'] } }] });
    expect(chosenScripts(d).map((a) => a.id)).toEqual(['S2']);
  });
});
