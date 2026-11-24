import type { AgentRole } from '@delebanana/domain';
import type { Appearance } from './appearance.ts';

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  appearance: Appearance;
}
