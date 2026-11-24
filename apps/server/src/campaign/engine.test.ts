import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { VideoCheck, VideoProbe } from '@delebanana/domain';
import { EventBus } from '../core/bus.ts';
import { runTx } from '../core/unitOfWork.ts';
import { agents, approvals, artifacts, campaignStages, campaigns, conversations, messages, tasks, videoVersions } from '../db/schema.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { ApprovalError, MVP_STAGES, activateCampaign, checkVideoUploadAllowed, createCampaign, currentRound, decideApproveVideo, decideChooseScript, deleteCampaign, latestVideoVersion, progressCampaign, recordVideoUpload } from './engine.ts';

const BRIEF = { goal: 'Tăng nhận diện', audience: 'Sinh viên', product: 'Trà sữa', platforms: ['tiktok'] };

function setup() {
  const { db, ids } = minimal();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => ++now };
  const tx = <T>(fn: Parameters<typeof runTx<T>>[1]) => runTx(deps, fn);
  const id = tx((u) => createCampaign(u, ids.workspace, 'Bông Bông'));
  const camp = () => db.select().from(campaigns).where(eq(campaigns.id, id)).get()!;
  const stage = (s: string) => db.select().from(campaignStages).where(and(eq(campaignStages.campaignId, id), eq(campaignStages.stage, s))).get()!;
  const addTask = (kind: string, status: string, stageName: string, withArtifact = true) => {
    const tid = `T-${kind}-${Math.random().toString(36).slice(2, 7)}`;
    db.insert(tasks).values({ id: tid, campaignId: id, stage: stageName, kind, requiredRole: 'researcher', status, createdAt: now, updatedAt: now }).run();
    if (withArtifact) db.insert(artifacts).values({ id: `A-${tid}`, taskId: tid, campaignId: id, kind: kind === 'script' ? 'script' : 'research_report', content: { text: kind }, createdAt: now }).run();
    return tid;
  };
  const activate = () => {
    db.update(campaigns).set({ brief: BRIEF }).where(eq(campaigns.id, id)).run();
    tx((u) => activateCampaign(u, id, `agent:${ids.director}`));
  };
  const progress = () => tx((u) => progressCampaign(u, id));
  const systemMessages = () => db.select().from(messages).all().filter((m) => m.role === 'system');
  return { db, ids, id, tx, camp, stage, addTask, activate, progress, systemMessages };
}

describe('tạo và bàn giao', () => {
  it('Campaign mới: briefing, 5 bước pending', () => {
    const s = setup();
    expect(s.camp()).toMatchObject({ status: 'briefing', stages: ['research', 'scripting', 'video', 'publishing'] });
    expect(s.db.select().from(campaignStages).where(eq(campaignStages.campaignId, s.id)).all().map((x) => x.status)).toEqual(Array(5).fill('pending'));
  });

  it('brief thiếu → không bàn giao được', () => {
    const s = setup();
    expect(() => s.tx((u) => activateCampaign(u, s.id, `agent:${s.ids.director}`))).toThrow('brief thiếu');
    expect(s.camp().status).toBe('briefing');
  });

  it('brief đủ → active, research chạy, bước ngoài danh sách skipped', () => {
    const s = setup();
    s.activate();
    expect(s.camp()).toMatchObject({ status: 'active', currentStage: 'research' });
    expect(s.stage('research').status).toBe('running');
    expect(['video', 'publishing', 'analytics'].map((x) => s.stage(x).status)).toEqual(['pending', 'pending', 'skipped']);
  });
});

describe('research', () => {
  it('nghiên cứu xong → tạo đúng 1 synthesis; synthesis xong → sang scripting', () => {
    const s = setup();
    s.activate();
    s.addTask('research.trend', 'done', 'research');
    s.addTask('research.audience', 'done', 'research');
    s.progress();
    s.progress();
    const synth = s.db.select().from(tasks).all().filter((t) => t.kind === 'research.synthesis');
    expect(synth).toHaveLength(1);
    expect(synth[0]).toMatchObject({ assigneeAgentId: s.ids.coordinator, status: 'queued' });
    expect(synth[0]!.dependsOn).toHaveLength(2);
    s.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, synth[0]!.id)).run();
    s.progress();
    expect(s.stage('research').status).toBe('done');
    expect(s.stage('scripting').status).toBe('running');
    expect(s.camp().currentStage).toBe('scripting');
  });
});

describe('scripting và chọn kịch bản', () => {
  function toApproval() {
    const s = setup();
    s.activate();
    s.db.update(campaignStages).set({ status: 'done' }).where(eq(campaignStages.id, s.stage('research').id)).run();
    s.db.update(campaignStages).set({ status: 'running' }).where(eq(campaignStages.id, s.stage('scripting').id)).run();
    s.db.update(campaigns).set({ currentStage: 'scripting' }).where(eq(campaigns.id, s.id)).run();
    const scripts = [1, 2, 3].map(() => s.addTask('script', 'done', 'scripting'));
    s.progress();
    const approval = s.db.select().from(approvals).where(eq(approvals.kind, 'choose_script')).get()!;
    return { ...s, scripts, approval };
  }

  it('3 kịch bản xong → chờ duyệt, 1 Approval với 3 artifact, báo Director', () => {
    const s = toApproval();
    s.progress();
    expect(s.stage('scripting').status).toBe('awaiting_approval');
    expect(s.db.select().from(approvals).all()).toHaveLength(1);
    expect(s.approval).toMatchObject({ status: 'pending', requestedByAgentId: s.ids.director });
    expect((s.approval.subject as { ids: string[] }).ids).toEqual(s.scripts.map((t) => `A-${t}`));
    expect(s.systemMessages().some((m) => m.content.includes('3 kịch bản') && m.campaignId === s.id)).toBe(true);
  });

  it('chiến dịch cũ (stages không có video): chọn 1 kịch bản → bước done → Campaign completed, video skipped', () => {
    const s = toApproval();
    s.db.update(campaigns).set({ stages: ['research', 'scripting'] }).where(eq(campaigns.id, s.id)).run();
    s.tx((u) => decideChooseScript(u, s.approval.id, 'approved', { chosen: [`A-${s.scripts[1]}`] }));
    expect(s.stage('scripting').status).toBe('done');
    expect(s.camp().status).toBe('completed');
    expect(s.stage('video').status).toBe('skipped');
  });

  it('chọn artifact lạ → lỗi 400, không đổi gì', () => {
    const s = toApproval();
    let err: unknown;
    try {
      s.tx((u) => decideChooseScript(u, s.approval.id, 'approved', { chosen: ['A-la'] }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApprovalError);
    expect((err as ApprovalError).code).toBe(400);
    expect(s.stage('scripting').status).toBe('awaiting_approval');
  });

  it('quyết định lần 2 → lỗi 409', () => {
    const s = toApproval();
    s.tx((u) => decideChooseScript(u, s.approval.id, 'rejected', { note: 'Chưa hay' }));
    expect(() => s.tx((u) => decideChooseScript(u, s.approval.id, 'approved', { chosen: [`A-${s.scripts[0]}`] }))).toThrow(ApprovalError);
  });

  it('yêu cầu sửa → bước chạy lại vòng 2, lưu ghi chú', () => {
    const s = toApproval();
    expect(currentRound(s.db, s.id)).toBe(1);
    s.tx((u) => decideChooseScript(u, s.approval.id, 'changes_requested', { note: 'Hook mạnh hơn' }));
    expect(s.stage('scripting')).toMatchObject({ status: 'running', summary: 'Hook mạnh hơn' });
    expect(currentRound(s.db, s.id)).toBe(2);
  });
});

describe('kẹt', () => {
  it('kịch bản: không task mở, chưa đủ 3 kịch bản, không có task thất bại → vẫn báo Director một lần', () => {
    const s = setup();
    s.activate();
    s.db.update(campaignStages).set({ status: 'done' }).where(eq(campaignStages.id, s.stage('research').id)).run();
    s.db.update(campaignStages).set({ status: 'running', startedAt: 0 }).where(eq(campaignStages.id, s.stage('scripting').id)).run();
    s.db.update(campaigns).set({ currentStage: 'scripting' }).where(eq(campaigns.id, s.id)).run();
    s.addTask('ideation', 'done', 'scripting');
    s.addTask('script', 'done', 'scripting');
    s.addTask('script', 'done', 'scripting');
    s.progress();
    s.progress();
    expect(s.systemMessages().filter((m) => m.content.includes('không thể tự tiếp tục') && m.campaignId === s.id)).toHaveLength(1);
  });

  it('synthesis thất bại → không tạo synthesis mới (không lặp), báo Director', () => {
    const s = setup();
    s.activate();
    s.addTask('research.trend', 'done', 'research');
    s.addTask('research.synthesis', 'failed', 'research', false);
    s.progress();
    expect(s.db.select().from(tasks).all().filter((t) => t.kind === 'research.synthesis')).toHaveLength(1);
    expect(s.systemMessages().filter((m) => m.content.includes('thất bại'))).toHaveLength(1);
  });

  it('task failed, hết task mở → báo Director một lần', () => {
    const s = setup();
    s.activate();
    s.addTask('research.trend', 'failed', 'research', false);
    s.progress();
    s.progress();
    expect(s.systemMessages().filter((m) => m.content.includes('thất bại'))).toHaveLength(1);
  });
});

describe('Tạo video (decision.video)', () => {
  function toApproval() {
    const s = setup();
    s.activate();
    s.db.update(campaignStages).set({ status: 'done' }).where(eq(campaignStages.id, s.stage('research').id)).run();
    s.db.update(campaignStages).set({ status: 'running' }).where(eq(campaignStages.id, s.stage('scripting').id)).run();
    s.db.update(campaigns).set({ currentStage: 'scripting' }).where(eq(campaigns.id, s.id)).run();
    s.db.insert(agents).values({ id: 'A-V', workspaceId: s.ids.workspace, roleTemplate: 'video_producer', title: 'vp', name: 'Vũ', provider: 'claude', model: 'sonnet', permissions: [], createdAt: T0, updatedAt: T0 }).run();
    s.db.insert(messages).values({ id: 'M1', conversationId: s.ids.conversation, role: 'user', content: 'ảnh', attachments: [{ id: 'IMG1', name: 'tra.png', mime: 'image/png' }], kind: 'chat', createdAt: T0 + 3 }).run();
    const scripts = [1, 2, 3].map(() => s.addTask('script', 'done', 'scripting'));
    s.progress();
    const approval = s.db.select().from(approvals).where(eq(approvals.kind, 'choose_script')).get()!;
    const videoTasks = () => s.db.select().from(tasks).all().filter((t) => t.kind === 'video.prompt');
    return { ...s, scripts, approval, videoTasks };
  }
  const approve = (s: ReturnType<typeof toApproval>, chosen: string[], video?: { toolId: string }) =>
    s.tx((u) => decideChooseScript(u, s.approval.id, 'approved', { chosen, ...(video && { video }) }));

  it('duyệt kèm toolId: chiến dịch active, bước video chạy, mỗi kịch bản một task video.prompt', () => {
    const s = toApproval();
    approve(s, [`A-${s.scripts[0]}`, `A-${s.scripts[2]}`], { toolId: 'gemini' });
    expect(s.camp()).toMatchObject({ status: 'active', currentStage: 'video' });
    expect(s.camp().stages).toContain('video');
    expect(s.stage('scripting').status).toBe('done');
    expect(s.stage('video').status).toBe('running');
    const vt = s.videoTasks();
    expect(vt).toHaveLength(2);
    expect(vt[0]).toMatchObject({ status: 'queued', requiredRole: 'video_producer', assigneeAgentId: 'A-V', stage: 'video', dependsOn: [s.scripts[0]] });
    expect(vt.map((t) => t.input.scriptArtifactId)).toEqual([`A-${s.scripts[0]}`, `A-${s.scripts[2]}`]);
    expect(vt.every((t) => t.input.toolId === 'gemini')).toBe(true);
    expect(vt[0]!.input.referenceCandidates).toEqual([{ id: 'IMG1', name: 'tra.png', mime: 'image/png' }]);
  });

  it('toolId chatgpt được chấp nhận', () => {
    const s = toApproval();
    approve(s, [`A-${s.scripts[0]}`], { toolId: 'chatgpt' });
    expect(s.videoTasks().every((t) => t.input.toolId === 'chatgpt')).toBe(true);
  });

  it('toolId lạ → 400, không đổi gì', () => {
    const s = toApproval();
    expect(() => approve(s, [`A-${s.scripts[0]}`], { toolId: 'sora' })).toThrow(expect.objectContaining({ code: 400 }));
    expect(s.stage('scripting').status).toBe('awaiting_approval');
    expect(s.videoTasks()).toHaveLength(0);
  });

  it('bước video đã skipped → 409', () => {
    const s = toApproval();
    s.db.update(campaignStages).set({ status: 'skipped' }).where(eq(campaignStages.id, s.stage('video').id)).run();
    expect(() => approve(s, [`A-${s.scripts[0]}`], { toolId: 'gemini' })).toThrow(expect.objectContaining({ code: 409 }));
    expect(s.camp().status).toBe('active');
  });

  it('task video.prompt xong → bước awaiting_approval, mỗi artifact một Approval make_video; gọi lặp không trùng', () => {
    const s = toApproval();
    approve(s, [`A-${s.scripts[0]}`, `A-${s.scripts[1]}`], { toolId: 'gemini' });
    for (const t of s.videoTasks()) {
      s.db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, t.id)).run();
      s.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, t.id)).run();
      s.db.insert(artifacts).values({ id: `V-${t.id}`, taskId: t.id, campaignId: s.id, kind: 'video_prompt', content: { text: 'p' }, createdAt: T0 }).run();
    }
    s.progress();
    s.progress();
    expect(s.stage('video').status).toBe('awaiting_approval');
    const made = s.db.select().from(approvals).all().filter((a) => a.kind === 'make_video');
    expect(made).toHaveLength(2);
    expect(made.every((a) => a.status === 'pending')).toBe(true);
    expect(made.map((a) => a.subject)).toEqual(s.videoTasks().map((t) => ({ kind: 'artifact', ids: [`V-${t.id}`], toolId: 'gemini' })));
    expect(s.camp().status).toBe('active');
  });

  it('còn task video đang chạy → chưa tạo Approval', () => {
    const s = toApproval();
    approve(s, [`A-${s.scripts[0]}`], { toolId: 'gemini' });
    s.progress();
    expect(s.stage('video').status).toBe('running');
    expect(s.db.select().from(approvals).all().filter((a) => a.kind === 'make_video')).toHaveLength(0);
  });

  it('ảnh ứng viên: tin gắn chiến dịch này + tin không gắn trong khung thời gian; loại tin của chiến dịch khác', () => {
    const s = toApproval();
    const other = s.tx((u) => createCampaign(u, s.ids.workspace, 'Chiến dịch khác'));
    const img = (id: string) => [{ id, name: `${id}.png`, mime: 'image/png' }];
    const add = (id: string, campaignId: string | null, at: number) =>
      s.db.insert(messages).values({ id: `M-${id}`, conversationId: s.ids.conversation, role: 'user', content: 'ảnh', attachments: img(id), campaignId, kind: 'chat', createdAt: at }).run();
    add('MINE', s.id, T0 + 4);
    add('OTHER', other, T0 + 5);
    approve(s, [`A-${s.scripts[0]}`], { toolId: 'gemini' });
    const ids = (s.videoTasks()[0]!.input.referenceCandidates as { id: string }[]).map((x) => x.id);
    expect(ids.sort()).toEqual(['MINE']);
  });

  it('ảnh ứng viên: chiến dịch không có ảnh gắn nó (dữ liệu cũ) → dùng tin không gắn trong khung thời gian', () => {
    const s = toApproval();
    const other = s.tx((u) => createCampaign(u, s.ids.workspace, 'Chiến dịch khác'));
    s.db.insert(messages).values({ id: 'M-OTHER', conversationId: s.ids.conversation, role: 'user', content: 'ảnh', attachments: [{ id: 'OTHER', name: 'o.png', mime: 'image/png' }], campaignId: other, kind: 'chat', createdAt: T0 + 5 }).run();
    approve(s, [`A-${s.scripts[0]}`], { toolId: 'gemini' });
    const ids = (s.videoTasks()[0]!.input.referenceCandidates as { id: string }[]).map((x) => x.id);
    expect(ids).toEqual(['IMG1']);
  });

  function withVideoTasks() {
    const s = toApproval();
    approve(s, [`A-${s.scripts[0]}`, `A-${s.scripts[1]}`], { toolId: 'gemini' });
    const [t1, t2] = s.videoTasks();
    return { ...s, t1: t1!, t2: t2! };
  }
  const finish = (s: ReturnType<typeof withVideoTasks>, t: { id: string }, status: 'done' | 'failed') => {
    s.db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, t.id)).run();
    s.db.update(tasks).set({ status }).where(eq(tasks.id, t.id)).run();
    if (status === 'done') s.db.insert(artifacts).values({ id: `V-${t.id}`, taskId: t.id, campaignId: s.id, kind: 'video_prompt', content: { text: 'p' }, createdAt: T0 }).run();
  };

  it('một prompt thất bại, một xong → vẫn Approval cho prompt xong, báo Director số thất bại, gọi lặp không trùng', () => {
    const s = withVideoTasks();
    finish(s, s.t1, 'done');
    finish(s, s.t2, 'failed');
    s.progress();
    s.progress();
    expect(s.stage('video').status).toBe('awaiting_approval');
    const made = s.db.select().from(approvals).all().filter((a) => a.kind === 'make_video');
    expect(made.map((a) => a.subject)).toEqual([{ kind: 'artifact', ids: [`V-${s.t1.id}`], toolId: 'gemini' }]);
    expect(s.systemMessages().filter((m) => m.content.includes('1 prompt thất bại'))).toHaveLength(1);
  });

  it('mọi prompt thất bại → không Approval, bước vẫn running, báo kẹt đúng một lần', () => {
    const s = withVideoTasks();
    finish(s, s.t1, 'failed');
    finish(s, s.t2, 'failed');
    s.progress();
    s.progress();
    expect(s.stage('video').status).toBe('running');
    expect(s.db.select().from(approvals).all().filter((a) => a.kind === 'make_video')).toHaveLength(0);
    expect(s.systemMessages().filter((m) => m.content.includes('không thể tự tiếp tục'))).toHaveLength(1);
  });

  it('MVP_STAGES có video; "Duyệt" không kèm nơi tạo video → làm video ở Gemini mặc định (Q-2), không skipped', () => {
    expect(MVP_STAGES).toContain('video');
    const s = toApproval();
    approve(s, [`A-${s.scripts[0]}`]);
    expect(s.camp()).toMatchObject({ status: 'active', currentStage: 'video' });
    expect(s.camp().stages.filter((x) => x === 'video')).toHaveLength(1);
    expect(s.stage('video').status).toBe('running');
    const vt = s.videoTasks();
    expect(vt).toHaveLength(1);
    expect(vt[0]!.input.toolId).toBe('gemini');
  });

  it('chiến dịch cũ + nút Tạo video vẫn thêm video vào stages đúng một lần', () => {
    const s = toApproval();
    s.db.update(campaigns).set({ stages: ['research', 'scripting'] }).where(eq(campaigns.id, s.id)).run();
    approve(s, [`A-${s.scripts[0]}`], { toolId: 'gemini' });
    expect(s.camp().stages).toEqual(['research', 'scripting', 'video']);
  });

  describe('tải lên và duyệt video', () => {
    const probe: VideoProbe = { formatName: 'mov,mp4', durationSeconds: 8, width: 720, height: 1280, codec: 'h264' };
    const ready: VideoCheck = { status: 'ready', reasons: [] };
    const invalid: VideoCheck = { status: 'invalid', reasons: ['Tỉ lệ sai'] };

    function atMakeVideo(count = 2, legacy = false) {
      const s = toApproval();
      if (legacy) {
        // Chiến dịch cũ: stages không có publishing, bước đăng đã skipped từ lúc bàn giao.
        s.db.update(campaigns).set({ stages: ['research', 'scripting', 'video'] }).where(eq(campaigns.id, s.id)).run();
        s.db.update(campaignStages).set({ status: 'skipped' }).where(and(eq(campaignStages.campaignId, s.id), eq(campaignStages.stage, 'publishing'))).run();
      }
      approve(s, s.scripts.slice(0, count).map((t) => `A-${t}`), { toolId: 'gemini' });
      for (const t of s.videoTasks()) {
        s.db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, t.id)).run();
        s.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, t.id)).run();
        s.db.insert(artifacts).values({ id: `V-${t.id}`, taskId: t.id, campaignId: s.id, kind: 'video_prompt', content: { text: 'p' }, createdAt: T0 }).run();
      }
      s.progress();
      const makes = s.db.select().from(approvals).all().filter((a) => a.kind === 'make_video');
      const versions = (approvalId: string) => s.db.select().from(videoVersions).where(eq(videoVersions.makeVideoApprovalId, approvalId)).orderBy(videoVersions.number).all();
      const upload = (approvalId: string, check: VideoCheck) => s.tx((u) => recordVideoUpload(u, approvalId, { mime: 'video/mp4', sizeBytes: 1000, probe, check }));
      const decide = (id: string, status: 'approved' | 'rejected' | 'changes_requested') => s.tx((u) => decideApproveVideo(u, id, status, {}));
      const approveVideos = () => s.db.select().from(approvals).all().filter((a) => a.kind === 'approve_video');
      return { ...s, makes, versions, upload, decide, approveVideos };
    }

    it('tạo make_video → phiên bản #1 awaiting_upload (manual, toolId)', () => {
      const s = atMakeVideo(1);
      expect(s.versions(s.makes[0]!.id)).toMatchObject([{ number: 1, status: 'awaiting_upload', provider: 'manual', toolId: 'gemini', videoId: (s.makes[0]!.subject as { ids: string[] }).ids[0] }]);
    });

    it('ready → phiên bản ready + Approval approve_video; đang ready thì tải tiếp → 409', () => {
      const s = atMakeVideo(1);
      const r = s.upload(s.makes[0]!.id, ready);
      expect(r).toMatchObject({ number: 1, status: 'ready', filename: `${r.versionId}.mp4` });
      expect(s.versions(s.makes[0]!.id)[0]).toMatchObject({ status: 'ready', path: r.filename, sizeBytes: 1000 });
      expect(s.approveVideos()).toHaveLength(1);
      expect(s.approveVideos()[0]).toMatchObject({ status: 'pending', subject: { kind: 'video_version', ids: [r.versionId], makeVideoApprovalId: s.makes[0]!.id } });
      expect(s.stage('video').status).toBe('awaiting_approval');
      expect(() => s.upload(s.makes[0]!.id, ready)).toThrow(expect.objectContaining({ code: 409 }));
    });

    it('invalid → lưu lý do, không có Approval, không có tệp; tải lại tạo phiên bản #2, #1 còn trong lịch sử', () => {
      const s = atMakeVideo(1);
      const id = s.makes[0]!.id;
      expect(s.upload(id, invalid)).toMatchObject({ number: 1, status: 'invalid', reasons: ['Tỉ lệ sai'] });
      expect(s.versions(id)[0]).toMatchObject({ status: 'invalid', path: null, invalidReasons: ['Tỉ lệ sai'] });
      expect(s.approveVideos()).toHaveLength(0);
      expect(s.upload(id, invalid).number).toBe(2);
      expect(s.upload(id, ready).number).toBe(3);
      expect(s.versions(id).map((v) => [v.number, v.status])).toEqual([[1, 'invalid'], [2, 'invalid'], [3, 'ready']]);
    });

    it('chiến dịch phiếu B chưa có phiên bản → tạo lúc tải lên', () => {
      const s = atMakeVideo(1);
      s.db.delete(videoVersions).run();
      expect(latestVideoVersion(s.db, s.makes[0]!.id)).toBeUndefined();
      expect(s.upload(s.makes[0]!.id, ready)).toMatchObject({ number: 1, status: 'ready' });
    });

    it('Approval không phải make_video / đã đóng / không có → 400/409/404', () => {
      const s = atMakeVideo(1);
      expect(() => checkVideoUploadAllowed(s.db, 'khong-co')).toThrow(expect.objectContaining({ code: 404 }));
      expect(() => checkVideoUploadAllowed(s.db, s.approval.id)).toThrow(expect.objectContaining({ code: 400 }));
      s.db.update(approvals).set({ status: 'expired' }).where(eq(approvals.id, s.makes[0]!.id)).run();
      expect(() => checkVideoUploadAllowed(s.db, s.makes[0]!.id)).toThrow(expect.objectContaining({ code: 409 }));
    });

    it('Duyệt: phiên bản approved, make_video approved, make_video khác expired, bước video done, chiến dịch sang bước đăng', () => {
      const s = atMakeVideo(2);
      const [m1, m2] = s.makes;
      const r = s.upload(m1!.id, ready);
      s.decide(s.approveVideos()[0]!.id, 'approved');
      expect(s.versions(m1!.id)[0]!.status).toBe('approved');
      expect(s.versions(m1!.id)[0]!.id).toBe(r.versionId);
      const status = (id: string) => s.db.select().from(approvals).where(eq(approvals.id, id)).get()!.status;
      expect(status(m1!.id)).toBe('approved');
      expect(status(m2!.id)).toBe('expired');
      expect(s.approveVideos().map((a) => a.status)).toEqual(['approved']);
      expect(s.stage('video').status).toBe('done');
      expect(s.camp()).toMatchObject({ status: 'active', currentStage: 'publishing' });
      expect(s.stage('publishing').status).toBe('running');
      expect(s.db.select().from(approvals).all().filter((a) => a.status === 'pending')).toHaveLength(0);
    });

    it('chiến dịch cũ (stages không có publishing): duyệt video xong → completed ngay như trước, không tạo task caption', () => {
      const s = atMakeVideo(1, true);
      s.upload(s.makes[0]!.id, ready);
      s.decide(s.approveVideos()[0]!.id, 'approved');
      expect(s.stage('video').status).toBe('done');
      expect(s.camp().status).toBe('completed');
      expect(s.stage('publishing').status).toBe('skipped');
      expect(s.db.select().from(tasks).all().filter((t) => t.kind === 'caption')).toHaveLength(0);
    });

    it('Từ chối: phiên bản rejected, prompt giữ nguyên, make_video vẫn mở, không task mới; tải bản mới được', () => {
      const s = atMakeVideo(1);
      const tasksBefore = s.db.select().from(tasks).all().length;
      s.upload(s.makes[0]!.id, ready);
      s.decide(s.approveVideos()[0]!.id, 'rejected');
      expect(s.versions(s.makes[0]!.id)[0]!.status).toBe('rejected');
      expect(s.db.select().from(approvals).where(eq(approvals.id, s.makes[0]!.id)).get()!.status).toBe('pending');
      expect(s.stage('video').status).toBe('awaiting_approval');
      expect(s.db.select().from(tasks).all()).toHaveLength(tasksBefore);
      expect(s.db.select().from(artifacts).where(eq(artifacts.kind, 'video_prompt')).all()).toHaveLength(1);
      expect(s.upload(s.makes[0]!.id, ready).number).toBe(2);
      expect(s.approveVideos().map((a) => a.status)).toEqual(['rejected', 'pending']);
    });

    it('changes_requested → 400; quyết lần 2 → 409; không phải approve_video → 400', () => {
      const s = atMakeVideo(1);
      s.upload(s.makes[0]!.id, ready);
      const av = s.approveVideos()[0]!;
      expect(() => s.decide(av.id, 'changes_requested')).toThrow(expect.objectContaining({ code: 400 }));
      expect(s.db.select().from(approvals).where(eq(approvals.id, av.id)).get()!.status).toBe('pending');
      expect(() => s.decide(s.makes[0]!.id, 'approved')).toThrow(expect.objectContaining({ code: 400 }));
      s.decide(av.id, 'approved');
      expect(() => s.decide(av.id, 'approved')).toThrow(expect.objectContaining({ code: 409 }));
    });

    it('xoá chiến dịch xoá luôn tin nhắn của nó, giữ tin của chiến dịch khác', () => {
      const s = atMakeVideo(1);
      const other = s.tx((u) => createCampaign(u, s.ids.workspace, 'Khác'));
      const say = (id: string, campaignId: string) => s.db.insert(messages).values({ id, conversationId: s.ids.conversation, role: 'user', content: id, campaignId, kind: 'chat', createdAt: T0 + 9 }).run();
      say('MINE', s.id);
      say('OTHER', other);
      s.tx((u) => deleteCampaign(u, s.id));
      const left = s.db.select().from(messages).all().map((m) => [m.id, m.campaignId]);
      expect(left).toContainEqual(['OTHER', other]);
      expect(left.map((m) => m[0])).not.toContain('MINE');
      expect(s.db.select().from(messages).all().filter((m) => m.campaignId === null && m.id === 'MINE')).toHaveLength(0);
    });

    it('xoá chiến dịch xoá phiên bản video và trả tên tệp', () => {
      const s = atMakeVideo(1);
      const r = s.upload(s.makes[0]!.id, ready);
      expect(s.db.select().from(videoVersions).all()).toHaveLength(1);
      const files = s.tx((u) => deleteCampaign(u, s.id));
      expect(files).toEqual([r.filename]);
      expect(s.db.select().from(videoVersions).all()).toHaveLength(0);
    });
  });
});
