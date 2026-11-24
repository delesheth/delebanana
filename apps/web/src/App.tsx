import { useSyncExternalStore } from 'react';
import { Office } from './scene/Office.tsx';
import { AgentChips } from './ui/AgentChips.tsx';
import { AgentPanel } from './ui/AgentPanel.tsx';
import { CampaignSidebar } from './ui/CampaignSidebar.tsx';
import { DirectorChat } from './ui/DirectorChat.tsx';
import { PowerButton } from './ui/PowerButton.tsx';
import { Launchers } from './ui/Launchers.tsx';
import { NotificationBell } from './ui/NotificationBell.tsx';
import { ProviderBanner } from './ui/ProviderBanner.tsx';
import { RoomDock } from './ui/RoomDock.tsx';
import { sidebars } from './ui/sidebarStore.ts';

/** Bố cục ba cột: Campaign | văn phòng 3D | chat Director. Sidebar đóng thì cột của nó rộng 0. */
export function App() {
  const { left, right } = useSyncExternalStore(sidebars.subscribe, sidebars.get);
  return (
    <main className={`app ${left ? 'left-open' : ''} ${right ? 'right-open' : ''}`}>
      {left ? <CampaignSidebar /> : <span />}
      <section className="stage">
        <Office />
        <AgentChips />
        <AgentPanel />
        <PowerButton />
        <ProviderBanner />
        <RoomDock />
        <Launchers />
        <NotificationBell />
      </section>
      {right ? <DirectorChat /> : <span />}
    </main>
  );
}
