// Nơi tạo video (D-13: thủ công, không bot điều khiển giao diện). Là dữ liệu cấu hình: thêm nơi mới chỉ cần thêm một mục
// vào VIDEO_TOOLS, không sửa luồng. Trần thời lượng theo từng nơi; không extend, không ghép clip (D-2).

export interface VideoTool {
  id: string;
  label: string;
  url: string;
  minSeconds: number;
  maxSeconds: number;
  maxReferenceImages: number;
  aspectRatio: string;
  note: string;
  source: string;
}

export const VIDEO_TOOLS: readonly VideoTool[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    minSeconds: 3,
    maxSeconds: 10,
    maxReferenceImages: 5,
    aspectRatio: '9:16',
    note: 'Gói Google AI Pro, model Gemini Omni 1.2 Flash. Một clip mỗi lần tạo.',
    source: 'https://support.google.com/gemini/answer/16126339 (kiểm 2026-11-23)',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    minSeconds: 3,
    maxSeconds: 10,
    maxReferenceImages: 5,
    aspectRatio: '9:16',
    note: 'Cần kiểm chứng: chưa có trang OpenAI xác nhận tạo video trong ChatGPT. Trần thận trọng, chưa phải giới hạn chính thức.',
    source: 'Cần kiểm chứng (nhiều nguồn báo app Sora đóng 26/4/2026; chưa có trang OpenAI xác nhận)',
  },
];

export const DEFAULT_VIDEO_TOOL_ID = 'gemini';

export const videoToolById = (id: string): VideoTool | undefined => VIDEO_TOOLS.find((t) => t.id === id);

export interface VideoSpec {
  durationSeconds: unknown;
  aspectRatio: unknown;
  referenceImageCount: number;
}

/** Kiểm thông số video theo nơi tạo video; trả mảng lỗi (rỗng = hợp lệ). */
export function checkVideoSpec(tool: VideoTool, spec: VideoSpec): string[] {
  const errors: string[] = [];
  const d = spec.durationSeconds;
  if (typeof d !== 'number' || !Number.isFinite(d)) errors.push(`Thiếu duration_seconds: ${tool.label} chỉ tạo clip ${tool.minSeconds}–${tool.maxSeconds} giây`);
  else if (d < tool.minSeconds || d > tool.maxSeconds) errors.push(`Thời lượng ${d} giây ngoài giới hạn của ${tool.label}: ${tool.minSeconds}–${tool.maxSeconds} giây`);
  if (spec.aspectRatio !== tool.aspectRatio) errors.push(`Tỉ lệ phải là ${tool.aspectRatio} (dọc), không phải ${String(spec.aspectRatio ?? 'trống')}`);
  if (spec.referenceImageCount > tool.maxReferenceImages) errors.push(`Tối đa ${tool.maxReferenceImages} ảnh tham chiếu cho ${tool.label}, đang có ${spec.referenceImageCount}`);
  return errors;
}

/** Câu cố định (tiếng Anh, vì dán vào Gemini) nêu khổ dọc và trần thời lượng; sinh từ cấu hình của nơi tạo video. */
export function videoPromptDirective(tool: VideoTool, durationSeconds?: number): string {
  const about = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? durationSeconds : tool.maxSeconds;
  return `Create ONE vertical ${tool.aspectRatio} (portrait) video, about ${about} seconds long, no longer than ${tool.maxSeconds} seconds.`;
}

/** Bảo đảm văn bản prompt có câu khổ dọc; idempotent (đã có thì giữ nguyên), nên dùng được cả ở server lẫn web cho artifact cũ. */
export function withVideoDirective(text: string, tool: VideoTool, durationSeconds?: number): string {
  const directive = videoPromptDirective(tool, durationSeconds);
  return text.includes(directive) ? text : `${directive}\n\n${text}`.trim();
}

// ---- Kiểm tệp video đã tải lên (phần thuần; metadata do ffprobe đọc ở server) ----

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** Cho phép vượt trần thời lượng tối đa 0,5 giây (sai số làm tròn của nơi tạo video). Cận dưới không nới: Reels cần ≥ 3 giây. */
export const DURATION_TOLERANCE_SECONDS = 0.5;
/** Sai lệch tương đối cho phép của tỉ lệ w/h so với 9:16. */
export const ASPECT_TOLERANCE = 0.02;
export const MIN_VIDEO_WIDTH = 540;
export const MIN_VIDEO_HEIGHT = 960;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;

/** Metadata tối thiểu của tệp video; `width`/`height` là kích thước lưu trong tệp (chưa tính xoay). */
export interface VideoProbe {
  formatName?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** Độ xoay hiển thị theo độ (ffprobe: tag `rotate` hoặc side data `rotation`). */
  rotation?: number;
  codec?: string;
}

export interface VideoCheck {
  status: 'ready' | 'invalid';
  reasons: string[];
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Đọc JSON của `ffprobe -print_format json -show_format -show_streams`; lấy luồng video đầu tiên. */
export function parseFfprobe(json: unknown): VideoProbe {
  const j = (json && typeof json === 'object' ? json : {}) as { format?: Record<string, unknown>; streams?: Record<string, unknown>[] };
  const stream = (Array.isArray(j.streams) ? j.streams : []).find((s) => s?.codec_type === 'video');
  const side = Array.isArray(stream?.side_data_list) ? (stream!.side_data_list as Record<string, unknown>[]) : [];
  const tags = (stream?.tags && typeof stream.tags === 'object' ? stream.tags : {}) as Record<string, unknown>;
  return {
    formatName: typeof j.format?.format_name === 'string' ? j.format.format_name : undefined,
    durationSeconds: num(j.format?.duration) ?? num(stream?.duration),
    width: num(stream?.width),
    height: num(stream?.height),
    rotation: num(tags.rotate) ?? side.map((d) => num(d.rotation)).find((r) => r !== undefined),
    codec: typeof stream?.codec_name === 'string' ? stream.codec_name : undefined,
  };
}

/** Kiểm tệp theo nơi tạo video; không sửa tệp (không cắt/đệm): sai tỉ lệ thì gợi ý tạo lại. */
export function checkVideoFile(tool: VideoTool, probe: VideoProbe, sizeBytes: number): VideoCheck {
  const reasons: string[] = [];
  if (sizeBytes > MAX_VIDEO_BYTES) reasons.push(`Tệp quá lớn (${(sizeBytes / 1048576).toFixed(1)} MB), tối đa ${MAX_VIDEO_BYTES / 1048576} MB`);
  const fmt = probe.formatName ?? '';
  if (!fmt.split(',').some((f) => f === 'mp4' || f === 'mov')) reasons.push(`Định dạng tệp phải là MP4 hoặc MOV, đang là ${fmt || 'không rõ'}`);
  if (probe.codec === undefined) reasons.push('Không thấy luồng video trong tệp');
  else if (probe.codec !== 'h264' && probe.codec !== 'hevc') reasons.push(`Codec phải là H.264 hoặc H.265, đang là ${probe.codec}`);
  const d = probe.durationSeconds;
  if (d === undefined) reasons.push('Không đọc được thời lượng');
  else if (d < tool.minSeconds || d > tool.maxSeconds + DURATION_TOLERANCE_SECONDS)
    reasons.push(`Thời lượng ${d.toFixed(2)} giây ngoài giới hạn ${tool.minSeconds}–${tool.maxSeconds} giây của ${tool.label} (cho phép lệch +${DURATION_TOLERANCE_SECONDS} giây)`);
  if (probe.width && probe.height) {
    const turned = Math.abs((probe.rotation ?? 0) % 180) === 90;
    const [w, h] = turned ? [probe.height, probe.width] : [probe.width, probe.height];
    const [rw, rh] = tool.aspectRatio.split(':').map(Number) as [number, number];
    const target = rw / rh;
    if (Math.abs(w / h - target) / target > ASPECT_TOLERANCE)
      reasons.push(`Tỉ lệ khung hình ${w}x${h} không phải ${tool.aspectRatio} (dọc). Hãy tạo lại ở ${tool.label} với tỉ lệ ${tool.aspectRatio}; hệ thống không tự cắt hay đệm viền.`);
    if (Math.min(w, h) < MIN_VIDEO_WIDTH || Math.max(w, h) < MIN_VIDEO_HEIGHT) reasons.push(`Độ phân giải ${w}x${h} nhỏ hơn tối thiểu ${MIN_VIDEO_WIDTH}x${MIN_VIDEO_HEIGHT}`);
  } else if (probe.codec !== undefined) reasons.push('Không đọc được độ phân giải');
  return { status: reasons.length === 0 ? 'ready' : 'invalid', reasons };
}
