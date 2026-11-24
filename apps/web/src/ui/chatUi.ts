// Trạng thái ô soạn tin Director: bản nháp và ảnh đã chọn nhưng chưa gửi (giữ lại khi sidebar thu gọn rồi mở lại).

import type { ImageUpload } from '../campaign/api.ts';

export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface PendingImage {
  key: string;
  /** data URL để xem trước. */
  preview: string;
  upload: ImageUpload;
}

export interface ChatUiState {
  draft: string;
  images: PendingImage[];
  /** Lỗi khi chọn ảnh (sai định dạng, quá lớn, quá nhiều). */
  pickError: string | null;
}

let state: ChatUiState = { draft: '', images: [], pickError: null };
const listeners = new Set<() => void>();
function set(patch: Partial<ChatUiState>) {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

let seq = 0;
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Không đọc được ảnh'));
    r.readAsDataURL(file);
  });
}

export const chatUi = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  setDraft: (draft: string) => set({ draft }),

  async addFiles(files: Iterable<File>) {
    const errors: string[] = [];
    const added: PendingImage[] = [];
    for (const file of files) {
      if (!ACCEPTED.has(file.type)) {
        errors.push(`${file.name || 'Tệp'}: chỉ nhận PNG, JPEG, WebP, GIF`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(`${file.name}: quá 10 MB`);
        continue;
      }
      if (state.images.length + added.length >= MAX_IMAGES) {
        errors.push(`Tối đa ${MAX_IMAGES} ảnh mỗi tin`);
        break;
      }
      try {
        const preview = await readDataUrl(file);
        const name = file.name || `anh-dan-${Date.now()}.${file.type.split('/')[1]}`;
        added.push({ key: `img-${++seq}`, preview, upload: { name, mime: file.type, data: preview.slice(preview.indexOf(',') + 1) } });
      } catch {
        errors.push(`${file.name}: không đọc được`);
      }
    }
    set({ images: [...state.images, ...added], pickError: errors.length ? errors.join(' · ') : null });
  },

  removeImage: (key: string) => set({ images: state.images.filter((i) => i.key !== key), pickError: null }),
  clear: () => set({ draft: '', images: [], pickError: null }),
};
