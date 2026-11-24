import { describe, expect, it } from 'vitest';
import { directorPrompt, planningPrompt, taskPrompt } from './prompts.ts';

const campaign = { title: 'Bông Bông', brief: {} };

describe('prompt bước kịch bản', () => {
  it('nêu trần thời lượng lấy từ cấu hình, một clip, dọc 9:16, không extend/ghép', () => {
    const p = planningPrompt({ campaign, stage: 'scripting', round: 1, roster: [], previous: [] });
    expect(p).toContain('3–10 giây');
    expect(p).toContain('MỘT clip');
    expect(p).toContain('9:16');
    expect(p).toMatch(/không dựa vào extend hay ghép/);
  });
});

describe('prompt task video.prompt', () => {
  const task = {
    id: 'T9',
    kind: 'video.prompt',
    input: { title: 'Soạn prompt video', instructions: 'x', toolId: 'gemini', referenceCandidates: [{ id: 'IMG1', name: 'tra.png' }, { id: 'IMG2', name: 'ly.png' }] },
  };

  it('nêu trần, một clip, 9:16, không extend/ghép, liệt kê ảnh và giới hạn ảnh', () => {
    const p = taskPrompt({ task, campaign, dependencies: [] });
    expect(p).toContain('3–10 giây');
    expect(p).toContain('MỘT clip');
    expect(p).toContain('9:16');
    expect(p).toMatch(/Không extend, không ghép/);
    expect(p).toContain('IMG1 — tra.png');
    expect(p).toContain('IMG2 — ly.png');
    expect(p).toContain('tối đa 5 ảnh');
    expect(p).toContain('duration_seconds');
  });

  it('không có ảnh ứng viên → nói rõ', () => {
    const p = taskPrompt({ task: { ...task, input: { ...task.input, referenceCandidates: [] } }, campaign, dependencies: [] });
    expect(p).toContain('Không có ảnh sản phẩm nào');
  });

  it('task khác không có khối video', () => {
    expect(taskPrompt({ task: { id: 'T1', kind: 'script', input: {} }, campaign, dependencies: [] })).not.toContain('duration_seconds');
  });
});

describe('prompt Director theo luồng', () => {
  const info = (id: string, title: string, status = 'briefing') => ({ id, title, status, currentStage: null, brief: { goal: `mục tiêu ${title}` }, pendingApprovals: [] as string[] });
  const msgs = [{ role: 'user', content: 'xin chào', kind: 'chat' }];

  it('luồng chiến dịch chỉ có khối của chiến dịch đó', () => {
    const p = directorPrompt({ messages: msgs, campaign: { ...info('CAMP_A', 'Bông Bông'), stages: [{ stage: 'research', status: 'running' }], pendingApprovals: ['choose_script'] } });
    expect(p).toContain('CAMP_A');
    expect(p).toContain('Bông Bông');
    expect(p).toContain('research (running)');
    expect(p).toContain('choose_script');
    expect(p).toContain('campaign_handoff');
    expect(p).not.toContain('CAMP_B');
    expect(p).not.toContain('campaign_create');
  });

  it('prompt không còn nhánh hội thoại chung hay campaign_create', () => {
    const p = directorPrompt({ messages: msgs, campaign: { ...info('CAMP_A', 'Bông Bông'), stages: [] } });
    expect(p).not.toContain('Hội thoại chung');
    expect(p).not.toContain('campaign_create');
  });
});

describe('prompt task caption', () => {
  it('nêu nền tảng, kịch bản (bọc dữ liệu ngoài), captions và giới hạn ký tự', () => {
    const task = { id: 'T10', kind: 'caption', input: { title: 'Viết caption', instructions: 'x', platforms: ['facebook', 'tiktok'], script: 'Kịch bản A', video: { durationSeconds: 8 } } };
    const p = taskPrompt({ task, campaign, dependencies: [] });
    expect(p).toContain('facebook, tiktok');
    expect(p).toContain('Kịch bản A');
    expect(p).toContain('captions');
    expect(p).toContain('2200');
    expect(p).toContain('bạn không đăng gì');
  });
});
