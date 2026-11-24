// Hiển thị văn bản Markdown đơn giản của Agent (kịch bản, báo cáo, tin nhắn): **đậm**, tiêu đề #, gạch đầu dòng.
// Không dùng thư viện và không chèn HTML thô, nên nội dung do LLM viết không chạy được mã.

import type { ReactNode } from 'react';

/** `**đậm**` → <strong>; phần còn lại giữ nguyên chữ. */
export function inlineMarkdown(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+?\*\*)/g)
    .map((part, i) => (part.length > 4 && part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((li, i) => <li key={i}>{inlineMarkdown(li)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(heading ? <h4 key={blocks.length}>{inlineMarkdown(heading[1]!)}</h4> : <p key={blocks.length}>{inlineMarkdown(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

/** Nội dung chữ của artifact (`{ text }`); dạng khác thì in gọn để vẫn đọc được. */
export function artifactText(content: unknown): string {
  const c = content as { text?: unknown } | null;
  if (c && typeof c.text === 'string') return c.text;
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

/** Tiêu đề = dòng chữ đầu tiên, bỏ ký hiệu Markdown. */
export function artifactTitle(content: unknown, fallback: string): string {
  const first = artifactText(content)
    .split('\n')
    .map((l) => l.replace(/[*#_`]/g, '').trim())
    .find(Boolean);
  return first ? (first.length > 90 ? `${first.slice(0, 88)}…` : first) : fallback;
}

/** Phần thân (bỏ dòng tiêu đề đã hiện riêng). */
export function artifactBody(content: unknown): string {
  const lines = artifactText(content).split('\n');
  const i = lines.findIndex((l) => l.trim());
  return lines.slice(i + 1).join('\n').trim();
}
