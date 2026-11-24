import { videoPromptDirective, videoToolById } from '@delebanana/domain';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/bus.ts';
import { agents, approvals, artifacts, audit, reviews, tasks } from '../db/schema.ts';
import { createApp } from '../http/app.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { Gateway } from './gateway.ts';

const JSON_HEADER = { 'content-type': 'application/json' };

function setup() {
  const { db, ids } = minimal();
  const deps = { db, bus: new EventBus(), clock: () => T0 + 1 };
  const gateway = new Gateway(deps);
  const app = createApp(deps, { gateway });
  const call = async (token: string, name: string, args: Record<string, unknown>) =>
    (await app.request(`/mcp/${token}`, { method: 'POST', headers: JSON_HEADER, body: JSON.stringify({ method: 'tools/call', params: { name, arguments: args } }) })).json();
  const list = async (token: string) => (await app.request(`/mcp/${token}`, { method: 'POST', headers: JSON_HEADER, body: JSON.stringify({ method: 'tools/list' }) })).json();
  const setTask = (status: string) => db.update(tasks).set({ status }).where(eq(tasks.id, ids.task)).run();
  return { db, ids, deps, gateway, call, list, setTask };
}
const auditRows = (db: ReturnType<typeof setup>['db']) => db.select().from(audit).all();

describe('token', () => {
  it('token lạ → lỗi, không ghi gì', async () => {
    const { db, call } = setup();
    const r = await call('khong-co', 'task_submit', { content: 'x' });
    expect(r.isError).toBe(true);
    expect(auditRows(db)).toHaveLength(0);
  });

  it('token là 64 ký tự hex', () => {
    const { ids, gateway } = setup();
    expect(gateway.register({ runId: 'R', agentId: ids.coordinator, workspaceId: ids.workspace, campaignId: ids.campaign, purpose: 'planning' }).token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('task_create (Coordinator, lượt planning)', () => {
  it('chỉ thấy task_create; tạo task đúng bước, giao đúng người', async () => {
    const { db, ids, gateway, call, list } = setup();
    const b = gateway.register({ runId: 'R1', agentId: ids.coordinator, workspaceId: ids.workspace, campaignId: ids.campaign, purpose: 'planning' });
    expect((await list(b.token)).tools.map((t: { name: string }) => t.name)).toEqual(['task_create']);
    const r = await call(b.token, 'task_create', { kind: 'research.audience', title: 'Khách hàng', instructions: 'Tìm hiểu', assignee_name: 'An' });
    expect(r.isError).toBeFalsy();
    const created = db.select().from(tasks).all().find((t) => t.kind === 'research.audience')!;
    expect(created).toMatchObject({ status: 'queued', assigneeAgentId: ids.researcher, requiredRole: 'researcher', stage: 'research' });
    expect(auditRows(db).some((a) => a.action === 'tool.task_create' && a.result === 'allowed' && a.cliRunId === 'R1')).toBe(true);
  });

  it('loại task không thuộc bước hiện tại → từ chối', async () => {
    const { ids, gateway, call } = setup();
    const b = gateway.register({ runId: 'R1', agentId: ids.coordinator, workspaceId: ids.workspace, campaignId: ids.campaign, purpose: 'planning' });
    expect((await call(b.token, 'task_create', { kind: 'script', title: 'Kịch bản', instructions: 'Viết' })).isError).toBe(true);
  });

  it('Researcher gọi task_create → từ chối, nhật ký denied', async () => {
    const { db, ids, gateway, call } = setup();
    const b = gateway.register({ runId: 'R2', agentId: ids.researcher, workspaceId: ids.workspace, campaignId: ids.campaign, taskId: ids.task, purpose: 'task' });
    expect((await call(b.token, 'task_create', { kind: 'research.trend', title: 'x', instructions: 'y' })).isError).toBe(true);
    expect(auditRows(db).some((a) => a.action === 'tool.task_create' && a.result === 'denied')).toBe(true);
  });

  it('Coordinator thiếu năng lực task.manage → Approval out_of_permission', async () => {
    const { db, ids, gateway, call } = setup();
    db.update(agents).set({ permissions: [] }).where(eq(agents.id, ids.coordinator)).run();
    const b = gateway.register({ runId: 'R1', agentId: ids.coordinator, workspaceId: ids.workspace, campaignId: ids.campaign, purpose: 'planning' });
    const r = await call(b.token, 'task_create', { kind: 'research.trend', title: 'x', instructions: 'y', assignee_name: 'An' });
    expect(r.isError).toBe(true);
    const a = db.select().from(approvals).get()!;
    expect(a).toMatchObject({ kind: 'out_of_permission', status: 'pending', requestedByAgentId: ids.coordinator });
    expect(a.subject).toMatchObject({ tool: 'task_create', arguments: { kind: 'research.trend' } });
  });
});

describe('task_submit', () => {
  const good = { content: 'Gen Z thích trà ít đường', sources: [{ url: 'https://vietcetera.com/a', claim: 'ít đường', confidence: 'medium' }] };

  it('nghiên cứu thiếu nguồn hoặc url sai → lỗi, task vẫn running', async () => {
    const { db, ids, gateway, call, setTask } = setup();
    setTask('running');
    const b = gateway.register({ runId: 'R2', agentId: ids.researcher, workspaceId: ids.workspace, campaignId: ids.campaign, taskId: ids.task, purpose: 'task' });
    expect((await call(b.token, 'task_submit', { content: 'x' })).isError).toBe(true);
    expect((await call(b.token, 'task_submit', { content: 'x', sources: [{ url: 'T1 tóm tắt', claim: 'a', confidence: 'low' }] })).isError).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, ids.task)).get()?.status).toBe('running');
    expect(b.submitted).toBe(false);
  });

  it('hợp lệ → Artifact research_report, submitted', async () => {
    const { db, ids, gateway, call, setTask } = setup();
    setTask('running');
    const b = gateway.register({ runId: 'R2', agentId: ids.researcher, workspaceId: ids.workspace, campaignId: ids.campaign, taskId: ids.task, purpose: 'task' });
    expect((await call(b.token, 'task_submit', good)).isError).toBeFalsy();
    expect(db.select().from(artifacts).get()).toMatchObject({ taskId: ids.task, kind: 'research_report', createdByAgentId: ids.researcher });
    expect(b.submitted).toBe(true);
  });

  it('lượt chạy không gắn task này → từ chối', async () => {
    const { ids, gateway, call, setTask } = setup();
    setTask('running');
    const other = gateway.register({ runId: 'R3', agentId: ids.researcher, workspaceId: ids.workspace, campaignId: ids.campaign, taskId: 'T-khac', purpose: 'task' });
    expect((await call(other.token, 'task_submit', good)).isError).toBe(true);
  });
});

describe('review_record', () => {
  function reviewing() {
    const s = setup();
    s.setTask('in_review');
    const b = s.gateway.register({ runId: 'R4', agentId: s.ids.coordinator, workspaceId: s.ids.workspace, campaignId: s.ids.campaign, purpose: 'review' });
    return { ...s, b };
  }

  it('rework → queued, attempt 2, lưu góp ý', async () => {
    const { db, ids, b, call } = reviewing();
    expect((await call(b.token, 'review_record', { task_id: ids.task, verdict: 'rework', feedback: 'Thiếu nguồn báo chí' })).isError).toBeFalsy();
    const t = db.select().from(tasks).where(eq(tasks.id, ids.task)).get()!;
    expect(t).toMatchObject({ status: 'queued', attempt: 2 });
    expect(t.input).toMatchObject({ feedback: 'Thiếu nguồn báo chí' });
    expect(db.select().from(reviews).get()).toMatchObject({ verdict: 'rework', attempt: 1, feedback: 'Thiếu nguồn báo chí', cliRunId: 'R4' });
  });

  it('pass_with_limits → done, lưu giới hạn', async () => {
    const { db, ids, b, call } = reviewing();
    await call(b.token, 'review_record', { task_id: ids.task, verdict: 'pass_with_limits', limits: 'Không có số liệu TikTok đối thủ (D-17)' });
    expect(db.select().from(tasks).where(eq(tasks.id, ids.task)).get()?.status).toBe('done');
    expect(db.select().from(reviews).get()?.limits).toContain('D-17');
  });
});

describe('task_submit — video.prompt', () => {
  const imgs = [{ id: 'IMG1', name: 'tra.png', mime: 'image/png' }, { id: 'IMG2', name: 'ly.png', mime: 'image/png' }];
  function videoTask() {
    const s = setup();
    s.db.insert(agents).values({ id: 'A-V', workspaceId: s.ids.workspace, roleTemplate: 'video_producer', title: 'vp', name: 'Vũ', provider: 'claude', model: 'sonnet', permissions: [], createdAt: T0, updatedAt: T0 }).run();
    s.db
      .update(tasks)
      .set({ kind: 'video.prompt', stage: 'video', requiredRole: 'video_producer', assigneeAgentId: 'A-V', status: 'running', input: { toolId: 'gemini', scriptArtifactId: 'S1', referenceCandidates: imgs } })
      .where(eq(tasks.id, s.ids.task))
      .run();
    const b = s.gateway.register({ runId: 'R5', agentId: 'A-V', workspaceId: s.ids.workspace, campaignId: s.ids.campaign, taskId: s.ids.task, purpose: 'task' });
    return { ...s, b };
  }
  const good = { content: 'Cận cảnh ly trà sữa, máy quay lia chậm, tiếng đá lách cách.', duration_seconds: 8, aspect_ratio: '9:16', reference_image_ids: ['IMG1'] };

  it.each([
    ['vượt trần', { duration_seconds: 12 }],
    ['thiếu thời lượng', { duration_seconds: undefined }],
    ['sai tỉ lệ', { aspect_ratio: '16:9' }],
  ])('%s → từ chối, lý do nêu trần 10 giây', async (_n, patch) => {
    const { db, b, call } = videoTask();
    const r = await call(b.token, 'task_submit', { ...good, ...patch });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('3–10 giây');
    expect(db.select().from(artifacts).all()).toHaveLength(0);
    expect(b.submitted).toBe(false);
  });

  it('ảnh lạ bị từ chối (nêu giới hạn nơi tạo video); id trùng được khử trùng', async () => {
    const { b, call } = videoTask();
    const r = await call(b.token, 'task_submit', { ...good, reference_image_ids: ['IMG9'] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Giới hạn của Gemini');
    expect(r.content[0].text).toContain('tối đa 5 ảnh tham chiếu');
    expect((await call(b.token, 'task_submit', { ...good, reference_image_ids: ['IMG1', 'IMG2', 'IMG1', 'IMG2', 'IMG1', 'IMG2'] })).isError).toBeFalsy();
  });

  it('6 ảnh riêng biệt (quá 5 ảnh) → từ chối, không tạo artifact', async () => {
    const { db, b, call } = videoTask();
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `M${i}`, name: `a${i}.png`, mime: 'image/png' }));
    db.update(tasks).set({ input: { toolId: 'gemini', scriptArtifactId: 'S1', referenceCandidates: many } }).where(eq(tasks.id, b.taskId!)).run();
    const r = await call(b.token, 'task_submit', { ...good, reference_image_ids: many.map((m) => m.id) });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('5 ảnh');
    expect(db.select().from(artifacts).all()).toHaveLength(0);
  });

  it('hợp lệ → artifact video_prompt đủ trường', async () => {
    const { db, b, call } = videoTask();
    expect((await call(b.token, 'task_submit', { ...good, reference_image_ids: ['IMG2', 'IMG1'] })).isError).toBeFalsy();
    expect(db.select().from(artifacts).get()).toMatchObject({
      kind: 'video_prompt',
      content: { text: `${videoPromptDirective(videoToolById('gemini')!, 8)}\n\n${good.content}`, durationSeconds: 8, aspectRatio: '9:16', toolId: 'gemini', scriptArtifactId: 'S1', referenceImages: [imgs[1], imgs[0]] },
    });
    expect(b.submitted).toBe(true);
  });

  it('văn bản lưu luôn có câu khổ dọc 9:16 và trần thời lượng; Agent tự viết sẵn câu đó thì không chèn lại', async () => {
    const { db, b, call } = videoTask();
    const directive = videoPromptDirective(videoToolById('gemini')!, 8);
    expect((await call(b.token, 'task_submit', { ...good, content: `${directive}\n\nCảnh một.` })).isError).toBeFalsy();
    const text = (db.select().from(artifacts).get()!.content as { text: string }).text;
    expect(text).toContain('vertical 9:16 (portrait)');
    expect(text).toContain('no longer than 10 seconds');
    expect(text.split(directive)).toHaveLength(2);
  });
});

describe('task_submit — caption', () => {
  function captionTask() {
    const s = setup();
    s.db.insert(agents).values({ id: 'A-P', workspaceId: s.ids.workspace, roleTemplate: 'publisher', title: 'pub', name: 'Giang', provider: 'claude', model: 'sonnet', permissions: [], createdAt: T0, updatedAt: T0 }).run();
    s.db
      .update(tasks)
      .set({ kind: 'caption', stage: 'publishing', requiredRole: 'publisher', assigneeAgentId: 'A-P', status: 'running', input: { platforms: ['facebook', 'tiktok'] } })
      .where(eq(tasks.id, s.ids.task))
      .run();
    const b = s.gateway.register({ runId: 'R6', agentId: 'A-P', workspaceId: s.ids.workspace, campaignId: s.ids.campaign, taskId: s.ids.task, purpose: 'task' });
    return { ...s, b };
  }
  const good = [
    { platform: 'facebook', text: 'Ly trà sữa mới', hashtags: ['trasua', '#bongbong'] },
    { platform: 'tiktok', text: 'POV: trà sữa', hashtags: [] },
  ];

  it('đúng mỗi nền tảng một mục → artifact caption có captions', async () => {
    const { db, b, call } = captionTask();
    expect((await call(b.token, 'task_submit', { content: 'xong', captions: good })).isError).toBeFalsy();
    expect(db.select().from(artifacts).get()).toMatchObject({ kind: 'caption', content: { captions: [{ platform: 'facebook', text: 'Ly trà sữa mới', hashtags: ['trasua', '#bongbong'] }, { platform: 'tiktok' }] } });
  });

  it.each([
    ['thiếu nền tảng', [good[0]]],
    ['thừa nền tảng', [...good, { platform: 'instagram', text: 'x' }]],
    ['trùng nền tảng', [good[0], good[0]]],
    ['caption trống', [good[0], { platform: 'tiktok', text: '  ' }]],
    ['quá dài', [good[0], { platform: 'tiktok', text: 'x'.repeat(2300) }]],
  ])('%s → từ chối, không tạo artifact', async (_n, captions) => {
    const { db, b, call } = captionTask();
    expect((await call(b.token, 'task_submit', { content: 'xong', captions })).isError).toBe(true);
    expect(db.select().from(artifacts).all()).toHaveLength(0);
  });
});
