import { ulid } from 'ulid';

/** Khoá chính ULID (sắp theo thời gian tạo, TK1 mục 3). */
export function newId(): string {
  return ulid();
}
