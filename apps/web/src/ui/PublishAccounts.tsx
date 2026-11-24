// Màn Kết nối tài khoản: Facebook (App ID/Secret cục bộ, nút Kết nối, dán Page token dự phòng, chọn Page, trạng thái/hạn token);
// Instagram tự liên kết theo Page (tài khoản IG Business/Creator gắn với Page); TikTok vẫn đăng tay có hỗ trợ.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../campaign/instance.ts';
import type { PublishAccountsView } from '../campaign/api.ts';
import { accountStatusText, oauthStartUrl } from './publishUi.ts';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PublishAccounts() {
  const [view, setView] = useState<PublishAccountsView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.getPublishAccounts().then(
      (v) => {
        setView(v);
        setAppId((cur) => cur || v.app.appId || '');
        setError(undefined);
      },
      (e) => setError(messageOf(e)),
    );
  }, []);
  useEffect(() => {
    if (!open) return;
    load();
    // Quay lại từ tab Facebook Login thì nạp lại để thấy tài khoản vừa kết nối.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [open, load]);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      after?.();
      load();
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
  }

  const now = Date.now();
  const fb = view?.accounts.filter((a) => a.platform === 'facebook') ?? [];
  const ig = view?.accounts.filter((a) => a.platform === 'instagram') ?? [];
  return (
    <details className="side-section publish-accounts" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <b>Kết nối tài khoản đăng bài</b>
      </summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h4>Facebook Page (đăng Reels tự động)</h4>
      {fb.map((a) => (
        <p key={a.id} className={a.status === 'expired' ? 'error' : 'detail'}>
          <b>{a.displayName}</b> — {accountStatusText(a, now)}{' '}
          <button type="button" className="small" disabled={busy} onClick={() => void run(() => api.disconnectAccount(a.id))}>
            Ngắt kết nối
          </button>
        </p>
      ))}
      {fb.length === 0 && <p className="hint">Chưa kết nối Page nào. Làm theo docs/guides/meta-app-setup.md để tạo app Meta, rồi điền bên dưới.</p>}

      {view?.pending.map((s) => (
        <div key={s.selectionId} className="actions">
          <span>Chọn Page để kết nối:</span>
          {s.pages.map((p) => (
            <button key={p.id} type="button" className="small primary" disabled={busy} onClick={() => void run(() => api.selectFacebookPage(s.selectionId, p.id))}>
              {p.name}
            </button>
          ))}
        </div>
      ))}

      <h5>1. App Meta (lưu trên máy này, không đưa vào repo)</h5>
      <div className="actions">
        <input placeholder="App ID" inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value)} />
        <input type="password" autoComplete="off" placeholder={view?.app.hasSecret ? 'App Secret (đã lưu — để trống để giữ)' : 'App Secret'} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button type="button" className="small primary" disabled={busy || !appId.trim()} onClick={() => void run(() => api.saveFacebookApp(appId, secret), () => setSecret(''))}>
          Lưu
        </button>
      </div>
      {view && (
        <p className="hint">
          Redirect URI cần khai ở Meta: <code>{view.app.redirectUri}</code>
        </p>
      )}

      <h5>2. Kết nối bằng Facebook Login</h5>
      <div className="actions">
        {view?.app.configured ? (
          <a className="button small primary" href={oauthStartUrl(view.app)} target="_blank" rel="noopener noreferrer">
            Kết nối Facebook
          </a>
        ) : (
          <span className="hint">Lưu App ID/Secret trước.</span>
        )}
      </div>

      <h5>Hoặc dán Page access token (dự phòng)</h5>
      <div className="actions">
        <input type="password" autoComplete="off" placeholder="Page access token (Graph API Explorer)" value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="button" className="small primary" disabled={busy || token.trim().length < 20} onClick={() => void run(() => api.connectFacebookToken(token), () => setToken(''))}>
          Kiểm và lưu
        </button>
      </div>

      <h4>Instagram (đăng Reels tự động theo Page)</h4>
      {ig.map((a) => (
        <p key={a.id} className={a.status === 'expired' ? 'error' : 'detail'}>
          <b>{a.displayName}</b> — liên kết với Page {fb.find((f) => f.id === a.parentAccountId)?.displayName ?? '(không rõ)'} · {accountStatusText(a, now)}
        </p>
      ))}
      {ig.length === 0 && (
        <p className="hint">
          {fb.length > 0
            ? 'Page chưa có tài khoản Instagram Business/Creator liên kết (hoặc token thiếu quyền instagram_basic, instagram_content_publish). Liên kết IG với Page rồi kết nối lại Page. Tới lúc đó Instagram đăng tay có hỗ trợ.'
            : 'Kết nối Facebook Page trước; tài khoản Instagram liên kết với Page sẽ tự hiện ở đây.'}
        </p>
      )}

      <h4>TikTok</h4>
      <p className="hint">Chế độ đăng tay có hỗ trợ — không cần kết nối. Sau khi bạn duyệt đăng, web chuẩn bị caption + video để bạn sao chép, tải xuống, mở trang đăng và bấm "Đã đăng".</p>
    </details>
  );
}
