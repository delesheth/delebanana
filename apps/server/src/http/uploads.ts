// Ảnh người dùng gửi kèm tin nhắn (ảnh sản phẩm). Lưu thành tệp `<ULID>.<đuôi>` trong thư mục uploads của dữ liệu;
// chỉ nhận ảnh raster phổ biến, nội dung gửi dạng base64 trong JSON (bộ chặn CSRF chỉ nhận application/json).

import type { MessageAttachment } from '@delebanana/domain';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../ids.ts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export class UploadError extends Error {}

export function saveUpload(dir: string, input: { name: unknown; mime: unknown; data: unknown }): MessageAttachment {
  const mime = String(input.mime ?? '');
  const ext = EXT[mime];
  if (!ext) throw new UploadError('Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF');
  if (typeof input.data !== 'string' || !input.data) throw new UploadError('Thiếu dữ liệu ảnh');
  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.length === 0) throw new UploadError('Dữ liệu ảnh không đọc được');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError('Ảnh quá lớn (tối đa 10 MB)');
  const name = String(input.name ?? '').trim().slice(0, 200) || `anh.${ext}`;
  const id = newId();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.${ext}`), bytes);
  return { id, name, mime };
}

/** Đường dẫn tệp của ảnh; `undefined` nếu id sai dạng hoặc không có tệp. */
export function uploadPath(dir: string, a: Pick<MessageAttachment, 'id' | 'mime'>): string | undefined {
  const ext = EXT[a.mime];
  if (!ext || !ULID.test(a.id)) return undefined;
  const file = join(dir, `${a.id}.${ext}`);
  return existsSync(file) ? file : undefined;
}

/** Tìm ảnh theo id (không biết trước đuôi). */
export function findUpload(dir: string, id: string): { file: string; mime: string } | undefined {
  for (const mime of Object.keys(EXT)) {
    const file = uploadPath(dir, { id, mime });
    if (file) return { file, mime };
  }
  return undefined;
}

export const readUpload = (file: string) => readFileSync(file);
