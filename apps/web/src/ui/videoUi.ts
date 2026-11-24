// Phần thuần của UI tạo video (kiểm thử không cần DOM): payload quyết định và nội dung màn "Làm video ở …".

import { MAX_VIDEO_BYTES, VIDEO_MIME_TYPES, VIDEO_TOOLS, withVideoDirective, type LatestVideo, type VideoTool } from '@delebanana/domain';

export interface VideoPromptContent {
  text: string;
  durationSeconds?: number;
  aspectRatio?: string;
  toolId?: string;
  referenceImages: { id: string; name: string; mime: string }[];
}

/** Quyết định duyệt kịch bản kèm nơi tạo video (nút "Tạo video"). */
export const chooseScriptVideoDecision = (chosen: string[], toolId: string) => ({ chosen, video: { toolId } });

export function readVideoPrompt(content: unknown): VideoPromptContent {
  const c = (content && typeof content === 'object' ? content : {}) as Record<string, unknown>;
  const images = Array.isArray(c.referenceImages) ? (c.referenceImages as VideoPromptContent['referenceImages']) : [];
  return {
    text: typeof c.text === 'string' ? c.text : '',
    durationSeconds: typeof c.durationSeconds === 'number' ? c.durationSeconds : undefined,
    aspectRatio: typeof c.aspectRatio === 'string' ? c.aspectRatio : undefined,
    toolId: typeof c.toolId === 'string' ? c.toolId : undefined,
    referenceImages: images,
  };
}

/** Các nơi có nút mở: nơi đã chọn, cùng tỉ lệ, trần giây không thấp hơn nơi đã chọn và chứa thời lượng của prompt. */
export function openTools(chosen: VideoTool, durationSeconds?: number, tools: readonly VideoTool[] = VIDEO_TOOLS): VideoTool[] {
  return tools.filter(
    (t) =>
      t.id === chosen.id ||
      (t.aspectRatio === chosen.aspectRatio &&
        t.maxSeconds >= chosen.maxSeconds &&
        (durationSeconds === undefined || (durationSeconds >= t.minSeconds && durationSeconds <= t.maxSeconds))),
  );
}

/** Giới hạn chặt nhất chung của các nơi (trần giây thấp nhất, sàn cao nhất, số ảnh ít nhất); một nơi thì giữ nguyên. */
export function strictestTool(tools: readonly VideoTool[]): VideoTool {
  const [first, ...rest] = tools as [VideoTool, ...VideoTool[]];
  return rest.reduce<VideoTool>(
    (m, t) => ({ ...m, minSeconds: Math.max(m.minSeconds, t.minSeconds), maxSeconds: Math.min(m.maxSeconds, t.maxSeconds), maxReferenceImages: Math.min(m.maxReferenceImages, t.maxReferenceImages) }),
    first,
  );
}

/** Các bước hướng dẫn người dùng tự làm ở nơi tạo video; nhiều nơi thì không gắn tên riêng và dùng giới hạn chặt nhất. */
export function videoGuide(tools: VideoTool | readonly VideoTool[]): string[] {
  const list = Array.isArray(tools) ? (tools as readonly VideoTool[]) : [tools as VideoTool];
  const t = strictestTool(list);
  const where = list.length === 1 ? t.label : 'nơi tạo video';
  return [
    `Chọn tỉ lệ khung hình ${t.aspectRatio} (dọc).`,
    `Đặt thời lượng không quá ${t.maxSeconds} giây (${where} chỉ tạo ${t.minSeconds}–${t.maxSeconds} giây).`,
    'Dán prompt đã sao chép vào ô nhập.',
    `Đính ảnh tham chiếu bên dưới (tối đa ${t.maxReferenceImages} ảnh).`,
  ];
}

/** Văn bản prompt hiển thị và được nút Sao chép chép: luôn có câu khổ dọc 9:16 + trần thời lượng (chặt nhất của các nơi có nút mở), kể cả artifact cũ thiếu câu. */
export const videoPromptText = (v: VideoPromptContent, tool: VideoTool, tools: readonly VideoTool[] = [tool]): string =>
  withVideoDirective(v.text, strictestTool(tools.length ? tools : [tool]), v.durationSeconds);

/** Lý do khoá nút "Tạo video"; `undefined` = dùng được (thiếu cờ = server cũ). */
export const createVideoBlockReason = (videoAvailable: boolean | undefined): string | undefined =>
  videoAvailable === false ? 'Chiến dịch này không làm được bước video (đã bỏ qua từ trước).' : undefined;

/** Kiểm nhanh tệp ở trình duyệt trước khi gửi (server vẫn kiểm lại); trả lý do hoặc `undefined`. */
export function videoFileProblem(file: { type: string; size: number }): string | undefined {
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) return 'Chỉ nhận video MP4 hoặc MOV (QuickTime).';
  if (file.size === 0) return 'Tệp video trống.';
  if (file.size > MAX_VIDEO_BYTES) return `Tệp quá lớn (tối đa ${MAX_VIDEO_BYTES / 1048576} MB).`;
  return undefined;
}

/** Sau lần tải lên: thành công thì xoá tệp đã chọn (và đổi key ô chọn tệp); thất bại thì giữ để bấm Tải lên lại. */
export const afterUpload = (result: unknown): { clearFile: boolean } => ({ clearFile: result !== undefined });

export interface UploadState {
  canUpload: boolean;
  label: string;
  reasons: string[];
}

/** Trạng thái ô tải video của màn "Làm video" theo phiên bản mới nhất. */
export function uploadState(latest: LatestVideo | null | undefined, tool: VideoTool): UploadState {
  switch (latest?.status) {
    case 'invalid':
      return { canUpload: true, label: `Bản ${latest.number} chưa hợp lệ. Hãy tạo lại ở ${tool.label} rồi tải bản mới.`, reasons: latest.invalidReasons ?? [] };
    case 'rejected':
      return { canUpload: true, label: `Bản ${latest.number} đã bị từ chối. Tải bản mới (prompt giữ nguyên).`, reasons: [] };
    case 'ready':
      return { canUpload: false, label: `Bản ${latest.number} đã tải lên, đang chờ bạn duyệt.`, reasons: [] };
    case 'approved':
      return { canUpload: false, label: `Bản ${latest.number} đã được duyệt.`, reasons: [] };
    default:
      return { canUpload: true, label: 'Chưa có video. Làm xong ở nơi tạo video thì tải tệp lên đây.', reasons: [] };
  }
}

export const videoFileUrl = (versionId: string) => `/api/videos/${encodeURIComponent(versionId)}/file`;
