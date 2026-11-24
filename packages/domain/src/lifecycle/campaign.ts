// Vòng đời Campaign — docs/design/02-lifecycle-events.md mục 4.1.

import { defineMachine } from '../machine.ts';

export type Platform = 'tiktok' | 'facebook' | 'instagram';

export interface CampaignBrief {
  goal?: string;
  audience?: string;
  product?: string;
  platforms?: Platform[];
}

export type CampaignStatus = 'briefing' | 'active' | 'paused' | 'completed' | 'cancelled';

const filled = (s?: string) => (s ?? '').trim().length > 0;

/** Trường bắt buộc để Director bàn giao cho Coordinator. */
export function isBriefComplete(b: CampaignBrief): boolean {
  return filled(b.goal) && filled(b.audience) && filled(b.product) && (b.platforms?.length ?? 0) > 0;
}

export const campaignMachine = defineMachine<CampaignStatus, { brief?: CampaignBrief }>({
  name: 'campaign',
  states: ['briefing', 'active', 'paused', 'completed', 'cancelled'],
  terminal: ['completed', 'cancelled'],
  transitions: [
    {
      from: 'briefing',
      to: 'active',
      by: ['agent'],
      guard: (ctx) => (ctx.brief && isBriefComplete(ctx.brief) ? null : 'brief thiếu trường bắt buộc'),
    },
    { from: 'active', to: 'paused', by: ['user'] },
    { from: 'paused', to: 'active', by: ['user'] },
    { from: 'active', to: 'completed', by: ['system'] },
    { from: 'briefing', to: 'cancelled', by: ['user'] },
    { from: 'active', to: 'cancelled', by: ['user'] },
    { from: 'paused', to: 'cancelled', by: ['user'] },
  ],
});
