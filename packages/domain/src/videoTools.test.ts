import { describe, expect, it } from 'vitest';
import { ASPECT_TOLERANCE, DEFAULT_VIDEO_TOOL_ID, DURATION_TOLERANCE_SECONDS, MAX_VIDEO_BYTES, VIDEO_TOOLS, checkVideoFile, checkVideoSpec, parseFfprobe, videoPromptDirective, videoToolById, withVideoDirective, type VideoProbe } from './videoTools.ts';

const gemini = videoToolById('gemini')!;
const ok = { durationSeconds: 8, aspectRatio: '9:16', referenceImageCount: 3 };

describe('VIDEO_TOOLS', () => {
  it('ChatGPT: trần thận trọng, ghi Cần kiểm chứng, mặc định vẫn gemini', () => {
    expect(videoToolById('chatgpt')).toMatchObject({ label: 'ChatGPT', url: 'https://chatgpt.com/', minSeconds: 3, maxSeconds: 10, aspectRatio: '9:16' });
    expect(videoToolById('chatgpt')!.note).toContain('Cần kiểm chứng');
    expect(videoToolById('chatgpt')!.source).toContain('Cần kiểm chứng');
    expect(DEFAULT_VIDEO_TOOL_ID).toBe('gemini');
  });

  it('có Gemini, nhãn không chứa Veo', () => {
    expect(VIDEO_TOOLS.map((t) => t.id)).toEqual(['gemini', 'chatgpt']);
    expect(gemini).toMatchObject({ label: 'Gemini', url: 'https://gemini.google.com/app', minSeconds: 3, maxSeconds: 10, maxReferenceImages: 5, aspectRatio: '9:16' });
    expect(gemini.label).not.toMatch(/veo/i);
    expect(gemini.source).toContain('support.google.com/gemini/answer/16126339');
    expect(videoToolById('la')).toBeUndefined();
  });
});

describe('checkVideoSpec', () => {
  it('hợp lệ → không lỗi', () => expect(checkVideoSpec(gemini, ok)).toEqual([]));

  it.each([
    [2, true],
    [3, false],
    [10, false],
    [11, true],
  ])('thời lượng %i giây → lỗi=%s', (d, bad) => {
    const errs = checkVideoSpec(gemini, { ...ok, durationSeconds: d });
    expect(errs.length > 0).toBe(bad);
    if (bad) expect(errs[0]).toContain('3–10 giây');
  });

  it('thiếu thời lượng, sai tỉ lệ, 6 ảnh → lỗi', () => {
    expect(checkVideoSpec(gemini, { ...ok, durationSeconds: undefined })[0]).toContain('10 giây');
    expect(checkVideoSpec(gemini, { ...ok, aspectRatio: '16:9' })[0]).toContain('9:16');
    expect(checkVideoSpec(gemini, { ...ok, referenceImageCount: 5 })).toEqual([]);
    expect(checkVideoSpec(gemini, { ...ok, referenceImageCount: 6 })[0]).toContain('5 ảnh');
  });
});

describe('câu khổ dọc', () => {
  it('nêu 9:16, vertical/portrait và trần maxSeconds', () => {
    const s = videoPromptDirective(gemini, 8);
    expect(s).toContain('vertical 9:16 (portrait)');
    expect(s).toContain('about 8 seconds');
    expect(s).toContain(`no longer than ${gemini.maxSeconds} seconds`);
    expect(videoPromptDirective(gemini)).toContain(`about ${gemini.maxSeconds} seconds`);
  });

  it('withVideoDirective thêm một lần, idempotent', () => {
    const once = withVideoDirective('Cảnh một…', gemini, 8);
    expect(once).toContain(videoPromptDirective(gemini, 8));
    expect(once).toContain('Cảnh một…');
    expect(withVideoDirective(once, gemini, 8)).toBe(once);
  });
});

describe('checkVideoFile', () => {
  const good: VideoProbe = { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSeconds: 8, width: 720, height: 1280, codec: 'h264' };
  const check = (p: Partial<VideoProbe>, size = 5_000_000) => checkVideoFile(gemini, { ...good, ...p }, size);

  it('hợp lệ → ready, không có lý do', () => {
    expect(check({})).toEqual({ status: 'ready', reasons: [] });
    expect(check({ codec: 'hevc', formatName: 'mov,mp4' }).status).toBe('ready');
  });

  it('thời lượng: biên 3 và 10,5 (maxSeconds + dung sai)', () => {
    expect(DURATION_TOLERANCE_SECONDS).toBe(0.5);
    expect(check({ durationSeconds: 3 }).status).toBe('ready');
    expect(check({ durationSeconds: 2.99 }).reasons[0]).toContain('Thời lượng');
    expect(check({ durationSeconds: 10.5 }).status).toBe('ready');
    expect(check({ durationSeconds: 10.51 }).reasons[0]).toContain('Thời lượng');
    expect(check({ durationSeconds: undefined }).reasons[0]).toContain('thời lượng');
  });

  it('tỉ lệ: lệch quá 2% → invalid kèm gợi ý tạo lại, không cắt/đệm', () => {
    expect(ASPECT_TOLERANCE).toBe(0.02);
    const r = check({ width: 1080, height: 1920 });
    expect(r.status).toBe('ready');
    const wide = check({ width: 1920, height: 1080 });
    expect(wide.status).toBe('invalid');
    expect(wide.reasons.join(' ')).toMatch(/tạo lại ở Gemini.*9:16/);
    expect(check({ width: 720, height: 1300 }).status).toBe('ready'); // lệch ~1,5%
    expect(check({ width: 720, height: 1340 }).reasons.join(' ')).toContain('Tỉ lệ');
  });

  it('tính xoay 90°: 1280x720 xoay 90 là dọc', () => {
    expect(check({ width: 1280, height: 720, rotation: 90 }).status).toBe('ready');
    expect(check({ width: 1280, height: 720, rotation: -90 }).status).toBe('ready');
    expect(check({ width: 720, height: 1280, rotation: 90 }).status).toBe('invalid');
  });

  it('độ phân giải nhỏ hơn 540x960', () => {
    const r = check({ width: 360, height: 640 });
    expect(r.status).toBe('invalid');
    expect(r.reasons.join(' ')).toContain('Độ phân giải 360x640');
    expect(check({ width: 540, height: 960 }).status).toBe('ready');
  });

  it('container, codec, dung lượng', () => {
    expect(check({ formatName: 'matroska,webm' }).reasons[0]).toContain('MP4 hoặc MOV');
    expect(check({ codec: 'vp9' }).reasons[0]).toContain('H.264 hoặc H.265');
    expect(check({ codec: undefined }).reasons[0]).toContain('luồng video');
    expect(check({}, MAX_VIDEO_BYTES).status).toBe('ready');
    expect(check({}, MAX_VIDEO_BYTES + 1).reasons[0]).toContain('quá lớn');
  });

  it('gộp mọi lý do', () => {
    expect(check({ formatName: 'avi', codec: 'mpeg4', durationSeconds: 60 }).reasons).toHaveLength(3);
  });
});

describe('parseFfprobe', () => {
  const sample = {
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '8.041000' },
    streams: [
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, side_data_list: [{ rotation: -90 }] },
    ],
  };
  it('lấy luồng video đầu, duration từ format, xoay từ side data', () => {
    expect(parseFfprobe(sample)).toEqual({ formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSeconds: 8.041, width: 1280, height: 720, rotation: -90, codec: 'h264' });
  });
  it('duration ở stream, xoay ở tag; JSON rác không ném', () => {
    expect(parseFfprobe({ streams: [{ codec_type: 'video', duration: '5', tags: { rotate: '90' } }] })).toMatchObject({ durationSeconds: 5, rotation: 90 });
    expect(parseFfprobe(null)).toEqual({ formatName: undefined, durationSeconds: undefined, width: undefined, height: undefined, rotation: undefined, codec: undefined });
  });
});
