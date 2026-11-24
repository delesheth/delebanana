// Danh sách bài đăng của chiến dịch: trạng thái, link, lỗi, Thử lại, và với bài đăng tay: Sao chép caption / Tải video /
// Mở trang đăng / Đã đăng (link tuỳ chọn) / Bỏ.

import type { PostRow } from '@delebanana/domain';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../campaign/instance.ts';
import { platformLabel, postActions, postStatusLabel, postVideoDownloadUrl, toDatetimeLocal, validateRetryWhen } from './publishUi.ts';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function PostItem({ p, onChanged }: { p: PostRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string>();
  const [local, setLocal] = useState(() => toDatetimeLocal(Date.now() + 60 * 60_000));
  const act = postActions(p, Date.now());

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      setMarking(false);
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(p.caption);
      setCopied(true);
    } catch {
      setError('Không sao chép được — bôi đen caption bên dưới và sao chép tay.');
    }
  }

  return (
    <li className={`post ${p.status}`}>
      <div className="post-head">
        <b>{platformLabel(p.platform)}</b> <span className={`status-badge ${p.status}`}>{postStatusLabel(p)}</span>
        {p.scheduledAt != null && p.status !== 'published' && <span className="hint"> · hẹn {new Date(p.scheduledAt).toLocaleString('vi-VN')}</span>}
        {p.permalink && (
          <>
            {' '}
            <a href={p.permalink} target="_blank" rel="noopener noreferrer">
              Xem bài
            </a>
          </>
        )}
      </div>
      {p.error && p.status === 'failed' && (
        <p className="error" role="alert">
          {p.error}
        </p>
      )}
      {act.manualHelpers && <textarea className="note" rows={3} readOnly value={p.caption} />}
      <div className="actions">
        {act.manualHelpers && (
          <>
            <button type="button" className="small" onClick={() => void copy()}>
              {copied ? 'Đã sao chép' : 'Sao chép caption'}
            </button>
            <a className="button small" href={postVideoDownloadUrl(p.videoVersionId)} download>
              Tải video xuống
            </a>
            {act.openUrl && (
              <a className="button small" href={act.openUrl} target="_blank" rel="noopener noreferrer">
                Mở trang đăng
              </a>
            )}
          </>
        )}
        {act.retry && (
          <button type="button" className="small primary" disabled={busy} onClick={() => void run(() => api.retryPost(p.id))}>
            Thử lại
          </button>
        )}
        {act.reschedule && (
          <>
            <button type="button" className="small primary" disabled={busy} onClick={() => void run(() => api.retryPost(p.id, { mode: 'now' }))}>
              Đăng ngay
            </button>
            <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
            <button
              type="button"
              className="small primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = validateRetryWhen(local, Date.now());
                  if (!r.ok) throw new Error(r.reason);
                  await api.retryPost(p.id, r.when);
                })
              }
            >
              Đổi giờ và thử lại
            </button>
          </>
        )}
        {act.markPublished && !marking && (
          <button type="button" className="small primary" disabled={busy} onClick={() => setMarking(true)}>
            Đã đăng
          </button>
        )}
        {act.cancel && !marking && (
          <button type="button" className="small" disabled={busy} onClick={() => void run(() => api.cancelPost(p.id))}>
            Bỏ
          </button>
        )}
      </div>
      {marking && (
        <div className="actions">
          <input type="url" placeholder="Link bài đăng (không bắt buộc)" value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className="small primary" disabled={busy} onClick={() => void run(() => api.markPostPublished(p.id, link))}>
            Xác nhận đã đăng
          </button>
          <button type="button" className="small" disabled={busy} onClick={() => setMarking(false)}>
            Huỷ
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** `refreshKey` đổi (chi tiết chiến dịch vừa nạp lại sau sự kiện) → tải lại danh sách. */
export function CampaignPosts({ campaignId, refreshKey }: { campaignId: string; refreshKey: unknown }) {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    api.listPosts(campaignId).then(
      (rows) => {
        setPosts(rows);
        setError(undefined);
      },
      (e) => setError(messageOf(e)),
    );
  }, [campaignId]);
  useEffect(load, [load, refreshKey]);
  const shown = posts.filter((p) => p.status !== 'draft' && p.status !== 'awaiting_approval');
  if (shown.length === 0 && !error) return null;
  return (
    <>
      <h3>Bài đăng</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="posts">
        {shown.map((p) => (
          <PostItem key={p.id} p={p} onChanged={load} />
        ))}
      </ul>
    </>
  );
}
