// Kiểm nguồn của kết quả nghiên cứu (D-4: mỗi phát hiện có nguồn và độ tin cậy). Backend gọi trong `task.submit`
// và từ chối lần nộp có lỗi (phát hiện của spike S5: có lần "nguồn" không phải URL).

export type Confidence = 'low' | 'medium' | 'high';

export interface Source {
  url: string;
  claim: string;
  confidence: Confidence;
}

const CONFIDENCES: readonly string[] = ['low', 'medium', 'high'];

/** Trả danh sách lỗi (rỗng = hợp lệ). */
export function validateSources(sources: readonly Source[]): string[] {
  const errors: string[] = [];
  sources.forEach((s, i) => {
    const at = `nguồn ${i + 1}`;
    let protocol = '';
    try {
      protocol = new URL(s.url).protocol;
    } catch {
      // URL không đọc được.
    }
    if (protocol !== 'http:' && protocol !== 'https:') errors.push(`${at}: url phải là liên kết http(s)`);
    if (!s.claim?.trim()) errors.push(`${at}: thiếu nội dung khẳng định (claim)`);
    if (!CONFIDENCES.includes(s.confidence)) errors.push(`${at}: độ tin cậy phải là low, medium hoặc high`);
  });
  return errors;
}
