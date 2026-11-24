// Vòng đời phiên bản video — mục 4.4. Provider chỉ có `manual` và `template` (D-13, D-14).

import { defineMachine } from '../machine.ts';

export type VideoProvider = 'manual' | 'template';

export type VideoVersionStatus = 'requested' | 'awaiting_upload' | 'rendering' | 'ready' | 'invalid' | 'approved' | 'rejected' | 'failed';

export const videoVersionMachine = defineMachine<VideoVersionStatus>({
  name: 'video_version',
  states: ['requested', 'awaiting_upload', 'rendering', 'ready', 'invalid', 'approved', 'rejected', 'failed'],
  terminal: ['approved', 'rejected', 'failed'],
  transitions: [
    { from: 'requested', to: 'awaiting_upload', by: ['system'] },
    { from: 'requested', to: 'rendering', by: ['system'] },
    { from: 'awaiting_upload', to: 'ready', by: ['system'] },
    { from: 'awaiting_upload', to: 'invalid', by: ['system'] },
    { from: 'invalid', to: 'ready', by: ['system'] },
    { from: 'rendering', to: 'ready', by: ['system'] },
    { from: 'rendering', to: 'failed', by: ['system'] },
    { from: 'ready', to: 'approved', by: ['system'] },
    { from: 'ready', to: 'rejected', by: ['system'] },
  ],
});
