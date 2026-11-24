// Che bí mật trước khi ghi nhật ký (TK3 mục 8, rủi ro T5).

const SECRET_KEY = /token|secret|authorization|key|password|cookie|^code$/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[đã che]' : redact(v)]));
  }
  return value;
}
