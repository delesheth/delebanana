// Danh sách tin kiểu Messenger: tin của mình bên phải (xanh), Director bên trái (xám), tin hệ thống ở giữa.
// Tin liên tiếp cùng người gộp thành một cụm; cách nhau lâu thì chèn mốc thời gian. Tự cuộn xuống tin mới nhất.

import type { MessageRow } from '@delebanana/domain';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { office } from '../sim/officeStore.ts';
import { freshIds } from './chatFresh.ts';
import { inlineMarkdown } from './markdown.tsx';

const GAP_MS = 10 * 60_000;
export const uploadUrl = (id: string) => `/api/uploads/${encodeURIComponent(id)}`;

function timeLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? hm : `${hm} · ${d.toLocaleDateString('vi-VN')}`;
}

function senderName(m: MessageRow): string {
  if (m.role === 'user') return 'Bạn';
  if (m.role === 'system') return 'Hệ thống';
  return (m.agentId && office.runtime(m.agentId)?.profile.name) || 'Director';
}

export function ChatThread({ messages, large = false }: { messages: MessageRow[]; large?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const last = messages.at(-1)?.id;
  // Tin đã hiện trong khung: chỉ tin Director lần đầu hiện (và mới tạo) có hiệu ứng xuất hiện, chạy một lần khi gắn vào DOM.
  const shown = useRef(new Set<string>());
  const fresh = freshIds(messages, shown.current, Date.now());
  useEffect(() => {
    for (const m of messages) shown.current.add(m.id);
  }, [messages]);

  // Cuộn xuống cuối khi có tin mới hoặc khi khung vừa mở.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  return (
    <>
      <ol ref={ref} className={`chat-thread ${large ? 'large' : ''}`} aria-live="polite">
        {messages.length === 0 && <li className="chat-empty">Chưa có tin nhắn. Gửi brief hoặc ảnh sản phẩm để bắt đầu.</li>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const gap = !prev || m.createdAt - prev.createdAt > GAP_MS;
          const first = gap || prev?.role !== m.role || prev?.agentId !== m.agentId;
          const lastOfGroup = !next || next.role !== m.role || next.agentId !== m.agentId || next.createdAt - m.createdAt > GAP_MS;
          const side = m.role === 'user' ? 'mine' : m.role === 'system' ? 'system' : 'theirs';
          return (
            <li key={m.id} className="chat-item">
              {gap && <div className="chat-time">{timeLabel(m.createdAt)}</div>}
              {side === 'system' ? (
                <div className="chat-system">{m.content}</div>
              ) : (
                <div className={`chat-row ${side} ${first ? 'first' : ''} ${lastOfGroup ? 'last' : ''} ${fresh.has(m.id) ? 'fresh' : ''}`}>
                  {side === 'theirs' && <span className="chat-avatar" aria-hidden>{lastOfGroup ? senderName(m).slice(0, 1).toUpperCase() : ''}</span>}
                  <div className="chat-col">
                    {side === 'theirs' && first && <span className="chat-name">{senderName(m)}</span>}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className={`chat-images n${Math.min(m.attachments.length, 3)}`}>
                        {m.attachments.map((a) => (
                          <button key={a.id} type="button" className="chat-image" onClick={() => setZoom(uploadUrl(a.id))} title={a.name}>
                            <img src={uploadUrl(a.id)} alt={a.name} loading="lazy" />
                          </button>
                        ))}
                      </div>
                    )}
                    {m.content && (
                      <div className="chat-bubble" title={timeLabel(m.createdAt)}>
                        {m.kind === 'question' && <span className="chat-tag">Câu hỏi</span>}
                        {side === 'theirs' ? inlineMarkdown(m.content) : m.content}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {zoom && (
        <div className="chat-lightbox" role="dialog" aria-label="Xem ảnh" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </>
  );
}
