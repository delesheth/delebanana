import type { CampaignRow } from '@delebanana/domain';
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { campaignStore } from '../campaign/instance.ts';
import { CampaignCreateForm } from './CampaignCreateForm.tsx';
import { CAMPAIGN_STATUS } from './campaignView.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

export function CampaignList() {
  const { campaigns, selectedId, campaignError } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get);
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    await campaignStore.remove(deleting.id);
    setBusy(false);
    setDeleting(null);
  }

  return (
    <section className="side-section">
      <h2>Chiến dịch của bạn</h2>
      <CampaignCreateForm />
      {campaignError && (
        <div className="error" role="alert">
          {campaignError}
        </div>
      )}
      <ul className="campaigns">
        {campaigns.length === 0 && <li className="hint">Chưa có chiến dịch nào.</li>}
        {campaigns.map((c) => (
          <li key={c.id} className="campaign-row">
            <button className={c.id === selectedId ? 'selected' : ''} onClick={() => campaignStore.select(c.id === selectedId ? null : c.id)}>
              <span>{c.title}</span>
              <span className={`status-badge ${c.status}`}>{CAMPAIGN_STATUS[c.status] ?? c.status}</span>
            </button>
            <button type="button" className="row-delete" onClick={() => setDeleting(c)} aria-label={`Xoá chiến dịch ${c.title}`} title="Xoá chiến dịch">
              Xoá
            </button>
          </li>
        ))}
      </ul>
      {deleting &&
        createPortal(
          <ConfirmDialog title="Xoá chiến dịch?" confirmLabel="Xoá vĩnh viễn" busy={busy} onConfirm={() => void confirmDelete()} onCancel={() => !busy && setDeleting(null)}>
            <p>
              Bạn có chắc muốn xoá <b>“{deleting.title}”</b>?
            </p>
            <p className="hint">Mọi kịch bản, báo cáo nghiên cứu và yêu cầu duyệt của chiến dịch này sẽ bị xoá và không khôi phục được. Tin nhắn với Dele vẫn được giữ.</p>
          </ConfirmDialog>,
          document.body,
        )}
    </section>
  );
}
