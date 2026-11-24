// Ô soạn tin: Enter gửi, Shift+Enter xuống dòng; đính kèm ảnh bằng nút 📎, dán (Ctrl/Cmd+V) hoặc kéo thả vào khung.

import { useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { campaignStore } from '../campaign/instance.ts';
import { chatUi } from './chatUi.ts';

export function ChatComposer({ autoFocus = false }: { autoFocus?: boolean }) {
  const { sending, chatError } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get);
  const { draft, images, pickError } = useSyncExternalStore(chatUi.subscribe, chatUi.get);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const canSend = !sending && (draft.trim().length > 0 || images.length > 0);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    // Giữ nháp và ảnh nếu gửi lỗi để người dùng thử lại.
    if (await campaignStore.send(draft, images.map((i) => i.upload))) chatUi.clear();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    void chatUi.addFiles(files);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void chatUi.addFiles(e.dataTransfer.files);
  }

  return (
    <form
      className={`chat-composer ${dragging ? 'dragging' : ''}`}
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {(chatError || pickError) && (
        <div className="error" role="alert">
          {chatError ?? pickError}
        </div>
      )}
      {images.length > 0 && (
        <ul className="chat-pending">
          {images.map((img) => (
            <li key={img.key}>
              <img src={img.preview} alt={img.upload.name} />
              <button type="button" onClick={() => chatUi.removeImage(img.key)} aria-label={`Bỏ ảnh ${img.upload.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat-input-row">
        <button type="button" className="chat-attach" onClick={() => fileRef.current?.click()} aria-label="Đính kèm ảnh sản phẩm" title="Đính kèm ảnh (hoặc dán / kéo thả)">
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void chatUi.addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          rows={1}
          value={draft}
          autoFocus={autoFocus}
          onChange={(e) => chatUi.setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={images.length ? 'Mô tả sản phẩm, mục tiêu quảng cáo…' : 'Nhắn cho Director…'}
          aria-label="Tin nhắn cho Director"
        />
        <button type="submit" className="chat-send" disabled={!canSend}>
          {sending ? '…' : 'Gửi'}
        </button>
      </div>
    </form>
  );
}
