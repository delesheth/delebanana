import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { campaignStore } from '../campaign/instance.ts';

/** Ô nhập tên + nút tạo Campaign; tạo xong store tự chọn chiến dịch mới. */
export function CampaignCreateForm({ submitLabel = 'Tạo' }: { submitLabel?: string }) {
  const { creating } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get);
  const [title, setTitle] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await campaignStore.create(title)) setTitle('');
  }

  return (
    <form onSubmit={submit} className="row">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tên chiến dịch mới, vd. Quảng cáo iPad Pro…" aria-label="Tên chiến dịch mới" />
      <button type="submit" disabled={creating || !title.trim()}>
        {submitLabel}
      </button>
    </form>
  );
}
