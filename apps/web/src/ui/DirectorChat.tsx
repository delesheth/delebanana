import { useSyncExternalStore } from 'react';
import { campaignStore } from '../campaign/instance.ts';
import { office, type ConnectionStatus } from '../sim/officeStore.ts';
import { CampaignCreateForm } from './CampaignCreateForm.tsx';
import { ChatComposer } from './ChatComposer.tsx';
import { ChatThread } from './ChatThread.tsx';
import { Sidebar } from './Sidebar.tsx';

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Đang kết nối…',
  online: 'Đang hoạt động',
  offline: 'Mất kết nối server',
};

/** Sidebar phải: chat với Director (kiểu Messenger, gửi kèm ảnh sản phẩm). */
export function DirectorChat() {
  const { messages, campaigns, selectedId, campaignError } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get);
  const { connection } = useSyncExternalStore(office.subscribeUi, office.getUi);
  const director = office.runtimes.find((rt) => rt.profile.role === 'director')?.profile.name;
  return (
    <Sidebar
      side="right"
      title={director ? `Director · ${director}` : 'Director'}
      icon={<span className="chat-avatar big">{(director ?? 'D').slice(0, 1).toUpperCase()}</span>}
      meta={
        <span className={`presence ${connection}`}>
          <i aria-hidden /> {CONNECTION_LABEL[connection]}
        </span>
      }
    >
      <div className="chat-threads" role="tablist" aria-label="Hội thoại với Director">
        {campaigns.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={c.id === selectedId} className={c.id === selectedId ? 'selected' : ''} onClick={() => campaignStore.select(c.id)} title={c.title}>
            {c.title}
          </button>
        ))}
      </div>
      {selectedId ? (
        <>
          <ChatThread messages={messages} large />
          <ChatComposer />
        </>
      ) : (
        <div className="chat-empty">
          <p>
            Chọn một chiến dịch ở trên, hoặc tạo chiến dịch mới để trao đổi brief với {director ?? 'Director'}. Chat chỉ diễn ra trong từng chiến dịch.
          </p>
          <CampaignCreateForm submitLabel="Tạo chiến dịch" />
          {campaignError && (
            <div className="error" role="alert">
              {campaignError}
            </div>
          )}
        </div>
      )}
    </Sidebar>
  );
}
