import { useSyncExternalStore } from 'react';
import { campaignStore } from '../campaign/instance.ts';
import { approvalStore } from '../sim/approvalStore.ts';
import { ApprovalPanel } from './ApprovalPanel.tsx';
import { CampaignDetail } from './CampaignDetail.tsx';
import { CampaignList } from './CampaignList.tsx';
import { PublishAccounts } from './PublishAccounts.tsx';
import { Sidebar } from './Sidebar.tsx';

/** Sidebar trái: việc chờ bạn duyệt, danh sách Campaign và chi tiết Campaign đang chọn. */
export function CampaignSidebar() {
  const { campaigns } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get);
  const { approvals } = useSyncExternalStore(approvalStore.subscribe, approvalStore.get, approvalStore.get);
  return (
    <Sidebar
      side="left"
      title="Campaign"
      meta={
        <span className="hint">
          {campaigns.length} chiến dịch{approvals.length > 0 && <b className="pending"> · {approvals.length} chờ duyệt</b>}
        </span>
      }
    >
      <ApprovalPanel />
      <CampaignList />
      <CampaignDetail />
      <PublishAccounts />
    </Sidebar>
  );
}
