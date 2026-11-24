import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalState } from '../sim/approvalStore.ts';

const h = vi.hoisted(() => ({ state: { approvals: [], providers: [], errors: { decide: null, unblock: null, approvals: null, providers: null } } as unknown }));
vi.mock('../sim/approvalStore.ts', () => ({
  approvalStore: { subscribe: () => () => {}, get: () => h.state, decide: vi.fn(), unblock: vi.fn() },
}));

const { ApprovalPanel, VideoToolPicker } = await import('./ApprovalPanel.tsx');
const { openTools, videoGuide, afterUpload, chooseScriptVideoDecision, createVideoBlockReason, uploadState, videoFileProblem, videoPromptText, readVideoPrompt, videoFileUrl } = await import('./videoUi.ts');
const { videoPromptDirective, videoToolById } = await import('@delebanana/domain');
const { ProviderBanner } = await import('./ProviderBanner.tsx');

const set = (s: Partial<ApprovalState>) => {
  h.state = { approvals: [], providers: [], errors: { decide: null, unblock: null, approvals: null, providers: null }, ...s };
};
const approval = (id: string, kind: string, subject: Record<string, unknown> = {}) => ({ id, kind, status: 'pending', subject });
const render = (c: Parameters<typeof createElement>[0]) => renderToStaticMarkup(createElement(c));

describe('ApprovalPanel', () => {
  beforeEach(() => set({}));

  it('approve_publish: caption từng nền tảng sửa được, chọn nền tảng, đăng ngay/lên lịch; chặn Duyệt khi Facebook chưa kết nối', () => {
    const post = (platform: string, caption: string) => ({ id: `P-${platform}`, platform, caption, mode: platform === 'facebook' ? 'api' : 'manual', status: 'awaiting_approval' });
    const a = { ...approval('A5', 'approve_publish', { ids: ['P-facebook', 'P-tiktok'] }), posts: [post('facebook', 'Cap FB'), post('tiktok', 'Cap TT')], video: { id: 'V1', number: 1, mime: 'video/mp4', sizeBytes: 1 }, facebookReady: false, reelsSpecReasons: [] };
    set({ approvals: [a] as never });
    const html = render(ApprovalPanel);
    expect(html).toContain('Duyệt đăng');
    expect(html).toContain('Facebook Reels');
    expect(html).toContain('TikTok');
    expect(html).toContain('Cap FB</textarea>');
    expect(html).toContain('Cap TT</textarea>');
    expect(html).toContain('Đăng ngay');
    expect(html).toContain('Lên lịch');
    expect(html).toContain('Facebook chưa kết nối');
    expect(html).toMatch(/<button class="primary" disabled="">✓ Duyệt đăng<\/button>/);
    expect(html).toContain('/api/videos/V1/file');
    set({ approvals: [{ ...a, facebookReady: true }] as never });
    expect(render(ApprovalPanel)).toMatch(/<button class="primary">✓ Duyệt đăng<\/button>/);
  });

  it('không hiện gì khi không có Approval và không lỗi', () => {
    expect(render(ApprovalPanel)).toBe('');
  });

  it('choose_script: hiện tiêu đề và đoạn xem trước của kịch bản thay vì mã; Duyệt khoá tới khi chọn', () => {
    const artifacts = [
      { id: 'S1', kind: 'script', content: { text: '**KỊCH BẢN A: Lọt khe 5 mm**\nHook là lát phô mai.' } },
      { id: 'S2', kind: 'script', content: { text: '**KỊCH BẢN B: Khách sửa lần 10**\nMở bằng tin nhắn khách.' } },
    ];
    set({ approvals: [{ ...approval('A1', 'choose_script', { ids: ['S1', 'S2'] }), artifacts }] as never });
    const html = render(ApprovalPanel);
    expect(html).toContain('KỊCH BẢN A: Lọt khe 5 mm');
    expect(html).toContain('Hook là lát phô mai.');
    expect(html).toContain('KỊCH BẢN B: Khách sửa lần 10');
    expect(html).not.toContain('>S1<');
    expect(html).toMatch(/<button class="primary" disabled="">Chọn ít nhất 1 kịch bản<\/button>/);
    expect(html).toContain('yêu cầu viết lại');
  });

  it('choose_script: nút "Tạo video" có và bị khoá khi chưa chọn kịch bản', () => {
    set({ approvals: [{ ...approval('A1', 'choose_script', { ids: ['S1'] }), artifacts: [{ id: 'S1', kind: 'script', content: { text: 'x' } }] }] as never });
    expect(render(ApprovalPanel)).toMatch(/<button disabled="">Tạo video<\/button>/);
  });

  it('danh sách nơi tạo video lấy từ VIDEO_TOOLS: Gemini và ChatGPT; payload quyết định kèm video.toolId', () => {
    const html = renderToStaticMarkup(createElement(VideoToolPicker, { onPick: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('>Gemini<');
    expect(html).toContain('>ChatGPT<');
    expect(html).not.toMatch(/veo/i);
    expect(chooseScriptVideoDecision(['S1', 'S2'], 'gemini')).toEqual({ chosen: ['S1', 'S2'], video: { toolId: 'gemini' } });
  });

  it('make_video: màn "Làm video ở Gemini" có prompt, Sao chép, ảnh, liên kết mở, hướng dẫn; không Duyệt/Từ chối', () => {
    const content = { text: 'Cận cảnh ly trà sữa', durationSeconds: 8, aspectRatio: '9:16', toolId: 'gemini', referenceImages: [{ id: 'IMG1', name: 'tra.png', mime: 'image/png' }] };
    set({ approvals: [{ ...approval('V1', 'make_video', { kind: 'artifact', ids: ['VA1'], toolId: 'gemini' }), artifacts: [{ id: 'VA1', kind: 'video_prompt', content }] }] as never });
    const html = render(ApprovalPanel);
    expect(html).toContain('Làm video ở Gemini');
    expect(html).toContain('Cận cảnh ly trà sữa');
    expect(html).toContain('>Sao chép<');
    expect(html).toContain('/api/uploads/IMG1');
    expect(html).toMatch(/<a [^>]*href="https:\/\/gemini\.google\.com\/app"[^>]*>/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Mở Gemini');
    expect(html).toContain('Mở ChatGPT');
    const links = [...html.matchAll(/<a [^>]*class="button"[^>]*>/g)].map((m) => m[0]);
    expect(links).toHaveLength(2);
    for (const l of links) expect(l).toMatch(/target="_blank"/), expect(l).toMatch(/rel="noopener noreferrer"/);
    expect(html).toMatch(/<div class="actions"><button[^>]*>[^<]*<\/button><a [^>]*class="button"[^>]*href="https:\/\/gemini\.google\.com\/app"/);
    expect(html).toMatch(/href="https:\/\/chatgpt\.com\/"/);
    expect(html).toContain('9:16');
    expect(html).toContain('10 giây');
    expect(html).not.toContain('>Duyệt<');
    expect(html).not.toContain('>Từ chối<');
  });

  it('out_of_permission: duyệt một lần, vĩnh viễn, từ chối', () => {
    set({ approvals: [approval('A2', 'out_of_permission', { tool: 'Bash', agentId: 'dev' })] as never });
    const html = render(ApprovalPanel);
    expect(html).toContain('Duyệt một lần');
    expect(html).toContain('Duyệt vĩnh viễn');
    expect(html).toContain('Từ chối');
  });

  it('loại khác: duyệt hoặc từ chối; hiện lỗi từ store', () => {
    set({ approvals: [approval('A3', 'strategy_change')] as never, errors: { decide: 'đã quyết định rồi', unblock: null, approvals: null, providers: null } });
    const html = render(ApprovalPanel);
    expect(html).toContain('>Duyệt<');
    expect(html).toContain('>Từ chối<');
    expect(html).toContain('đã quyết định rồi');
  });

  it('hiện lỗi nạp lại danh sách; hai nguồn lỗi cùng thông điệp đều hiện', () => {
    set({ approvals: [approval('A4', 'strategy_change')] as never, errors: { decide: 'trùng', unblock: null, approvals: 'trùng', providers: null } });
    const html = render(ApprovalPanel);
    expect(html.match(/trùng/g)).toHaveLength(2);
    set({ errors: { decide: null, unblock: null, approvals: 'mất mạng', providers: null } });
    expect(render(ApprovalPanel)).toContain('mất mạng');
  });
});

describe('ProviderBanner', () => {
  const p = (provider: string, blockedUntil: number | null, blockReason: string | null = null) =>
    ({ provider, blockedUntil, blockReason, utilization5h: null, utilization7d: null, resetsAt: null });

  it('không hiện khi không provider nào bị chặn hoặc đã hết hạn chặn', () => {
    set({ providers: [p('claude', null), p('gemini', Date.now() - 1000, 'quota')] });
    expect(render(ProviderBanner)).toBe('');
  });

  it('hiện lý do và nút Mở khoá cho provider đang bị chặn, kèm lỗi server', () => {
    set({ providers: [p('claude', Date.now() + 3_600_000, 'quota')], errors: { decide: null, unblock: 'unblock thất bại', approvals: null, providers: null } });
    const html = render(ProviderBanner);
    expect(html).toContain('claude');
    expect(html).toContain('đã hết hạn mức gói');
    expect(html).toContain('Mở khoá');
    expect(html).toContain('unblock thất bại');
  });

  it('banner chỉ có lỗi (không provider bị chặn) vẫn hiện, gồm lỗi nạp lại provider', () => {
    set({ providers: [p('claude', null)], errors: { decide: null, unblock: null, approvals: null, providers: 'không nạp được' } });
    const html = render(ProviderBanner);
    expect(html).toContain('không nạp được');
    expect(html).not.toContain('Mở khoá');
  });

  it('hai nguồn lỗi cùng thông điệp đều hiện', () => {
    set({ errors: { decide: null, unblock: 'lỗi', approvals: null, providers: 'lỗi' } });
    expect(render(ProviderBanner).match(/lỗi/g)).toHaveLength(2);
  });
});

describe('video: câu khổ dọc, tải lên, duyệt, khoá nút', () => {
  const gemini = videoToolById('gemini')!;
  const makeVideo = (latestVideo: unknown, text = 'Cận cảnh ly trà sữa') =>
    ({ ...approval('V1', 'make_video', { kind: 'artifact', ids: ['VA1'], toolId: 'gemini' }), latestVideo, artifacts: [{ id: 'VA1', kind: 'video_prompt', content: { text, durationSeconds: 8, aspectRatio: '9:16', toolId: 'gemini', referenceImages: [] } }] }) as never;

  it('artifact cũ thiếu câu: màn Làm video hiển thị (và Sao chép chép) văn bản có câu khổ dọc 9:16', () => {
    const v = readVideoPrompt({ text: 'Cận cảnh ly trà sữa', durationSeconds: 8 });
    const shown = videoPromptText(v, gemini);
    expect(shown).toContain(videoPromptDirective(gemini, 8));
    expect(shown).toContain('vertical 9:16 (portrait)');
    expect(shown).toContain('no longer than 10 seconds');
    // Câu đã có sẵn (artifact mới từ gateway) thì không chèn lần hai.
    expect(videoPromptText({ ...v, text: shown }, gemini)).toBe(shown);
    set({ approvals: [makeVideo(null)] });
    expect(render(ApprovalPanel)).toContain('vertical 9:16 (portrait)');
  });

  it('make_video: ô chọn tệp + nút Tải lên; invalid hiện lý do và cho tải lại; ready thì khoá tải lên', () => {
    set({ approvals: [makeVideo(null)] });
    let html = render(ApprovalPanel);
    expect(html).toContain('type="file"');
    expect(html).toContain('Tải lên');
    set({ approvals: [makeVideo({ id: 'VV1', number: 1, status: 'invalid', invalidReasons: ['Tỉ lệ khung hình 1920x1080 không phải 9:16'], sizeBytes: 1, mime: 'video/mp4' })] });
    html = render(ApprovalPanel);
    expect(html).toContain('Tỉ lệ khung hình 1920x1080 không phải 9:16');
    expect(html).toContain('type="file"');
    set({ approvals: [makeVideo({ id: 'VV1', number: 1, status: 'ready', invalidReasons: null, sizeBytes: 1, mime: 'video/mp4' })] });
    html = render(ApprovalPanel);
    expect(html).not.toContain('type="file"');
    expect(html).toContain('đang chờ bạn duyệt');
  });

  it('afterUpload: tải lỗi (undefined) giữ tệp; tải xong xoá tệp và đổi ô chọn', () => {
    expect(afterUpload(undefined)).toEqual({ clearFile: false });
    expect(afterUpload({ versionId: 'v', number: 1, status: 'ready', reasons: [] })).toEqual({ clearFile: true });
  });

  it('uploadState theo trạng thái; videoFileProblem chặn sai loại, rỗng, quá 200 MB', () => {
    expect(uploadState(undefined, gemini).canUpload).toBe(true);
    expect(uploadState({ id: 'V', number: 2, status: 'rejected', invalidReasons: null, sizeBytes: 1, mime: null }, gemini)).toMatchObject({ canUpload: true });
    expect(uploadState({ id: 'V', number: 1, status: 'approved', invalidReasons: null, sizeBytes: 1, mime: null }, gemini).canUpload).toBe(false);
    expect(videoFileProblem({ type: 'video/mp4', size: 10 })).toBeUndefined();
    expect(videoFileProblem({ type: 'video/quicktime', size: 10 })).toBeUndefined();
    expect(videoFileProblem({ type: 'video/webm', size: 10 })).toContain('MP4 hoặc MOV');
    expect(videoFileProblem({ type: 'video/mp4', size: 0 })).toContain('trống');
    expect(videoFileProblem({ type: 'video/mp4', size: 200 * 1024 * 1024 + 1 })).toContain('200 MB');
  });

  it('approve_video: thẻ video phát từ route tệp, có Duyệt và Từ chối', () => {
    set({ approvals: [{ ...approval('AV1', 'approve_video', { kind: 'video_version', ids: ['VV1'] }), latestVideo: { id: 'VV1', number: 2, status: 'ready', invalidReasons: null, sizeBytes: 1, mime: 'video/mp4' } }] as never });
    const html = render(ApprovalPanel);
    expect(html).toContain('<video');
    expect(html).toContain('controls');
    expect(html).toContain(`src="${videoFileUrl('VV1')}"`);
    expect(videoFileUrl('VV1')).toBe('/api/videos/VV1/file');
    expect(html).toContain('Duyệt video');
    expect(html).toContain('>Từ chối<');
    expect(html).toContain('Duyệt video');
  });

  it('nút Tạo video khoá kèm lý do khi videoAvailable=false; mở khi true hoặc thiếu cờ', () => {
    expect(createVideoBlockReason(false)).toContain('đã bỏ qua');
    expect(createVideoBlockReason(true)).toBeUndefined();
    expect(createVideoBlockReason(undefined)).toBeUndefined();
    const choose = (videoAvailable?: boolean) =>
      ({ ...approval('A1', 'choose_script', { ids: ['S1'] }), ...(videoAvailable === undefined ? {} : { videoAvailable }), artifacts: [{ id: 'S1', kind: 'script', content: { text: 'x' } }] }) as never;
    set({ approvals: [choose(false)] });
    const html = render(ApprovalPanel);
    expect(html).toMatch(/<button disabled="" title="[^"]*đã bỏ qua[^"]*">Tạo video<\/button>/);
    expect(html).toContain('không làm được bước video');
  });
});

describe('nhiều nơi mở video', () => {
  const gem = videoToolById('gemini')!;
  const gpt = videoToolById('chatgpt')!;
  it('openTools loại nơi khác tỉ lệ, trần thấp hơn hoặc không chứa thời lượng', () => {
    expect(openTools(gem, 8).map((t) => t.id)).toEqual(['gemini', 'chatgpt']);
    expect(openTools(gem, undefined, [gem, { ...gpt, aspectRatio: '16:9' }]).map((t) => t.id)).toEqual(['gemini']);
    expect(openTools(gem, 8, [gem, { ...gpt, maxSeconds: 6 }]).map((t) => t.id)).toEqual(['gemini']);
    expect(openTools(gem, 2, [gem, gpt]).map((t) => t.id)).toEqual(['gemini']);
  });
  it('videoGuide: nhiều nơi không gắn tên, một nơi giữ tên', () => {
    const many = videoGuide([gem, { ...gpt, maxSeconds: 8, maxReferenceImages: 3 }]).join('\n');
    expect(many).not.toMatch(/Gemini|ChatGPT/);
    expect(many).toContain('9:16');
    expect(many).toContain('8 giây');
    expect(many).toContain('3 ảnh');
    expect(videoGuide([gem]).join('\n')).toContain('Gemini');
  });
  it('prompt dùng trần chặt nhất', () => {
    const v = { text: 'x', durationSeconds: 8, referenceImages: [] };
    expect(videoPromptText(v, gem, [gem, { ...gpt, maxSeconds: 8 }])).toContain('no longer than 8 seconds');
  });
});
