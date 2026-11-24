import { describe, expect, it } from 'vitest';
import { artifactBody, artifactText, artifactTitle } from './markdown.tsx';

describe('artifact dạng chữ', () => {
  const content = { text: '**KỊCH BẢN A: "Lọt khe 5 mm"** (9:16, ~23s)\nÝ chính: hook là lát phô mai.\n\n- Cảnh 1' };
  it('tiêu đề là dòng đầu, bỏ ký hiệu Markdown', () => {
    expect(artifactTitle(content, 'x')).toBe('KỊCH BẢN A: "Lọt khe 5 mm" (9:16, ~23s)');
  });
  it('thân bỏ dòng tiêu đề', () => {
    expect(artifactBody(content)).toBe('Ý chính: hook là lát phô mai.\n\n- Cảnh 1');
  });
  it('nội dung không có text vẫn đọc được; rỗng dùng tên dự phòng', () => {
    expect(artifactText({ a: 1 })).toContain('"a": 1');
    expect(artifactTitle({ text: '' }, 'Kịch bản 1')).toBe('Kịch bản 1');
  });
});
