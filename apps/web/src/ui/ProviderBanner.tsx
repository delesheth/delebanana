// Banner khi provider bị chặn (hết hạn mức gói): nêu lý do và cho người dùng mở khoá.

import { useSyncExternalStore } from 'react';
import { approvalStore } from '../sim/approvalStore.ts';

const REASON_LABEL: Record<string, string> = {
  overage: 'đã hết hạn mức gói, đang chạm phần tính phí thêm',
  quota: 'đã hết hạn mức gói',
};

export function ProviderBanner() {
  const { providers, errors } = useSyncExternalStore(approvalStore.subscribe, approvalStore.get, approvalStore.get);
  const now = Date.now();
  const blocked = providers.filter((p) => p.blockedUntil !== null && p.blockedUntil > now);
  const shown = (['unblock', 'providers'] as const).flatMap((k) => (errors[k] === null ? [] : [{ k, m: errors[k] }]));
  if (blocked.length === 0 && shown.length === 0) return null;
  return (
    <div className="provider-banner" role="alert">
      {blocked.map((p) => (
        <div key={p.provider} className="row">
          <span>
            <b>{p.provider}</b> bị chặn: {(p.blockReason && REASON_LABEL[p.blockReason]) ?? p.blockReason ?? 'không rõ lý do'}
            {p.blockedUntil === Number.MAX_SAFE_INTEGER ? ' — tới khi mở khoá' : ` — tới ${new Date(p.blockedUntil!).toLocaleString()}`}
          </span>
          <button onClick={() => void approvalStore.unblock(p.provider)}>Mở khoá</button>
        </div>
      ))}
      {shown.map(({ k, m }) => (
        <p key={k} className="error">{m}</p>
      ))}
    </div>
  );
}
