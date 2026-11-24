import { AGENT_STATES, STATE_BEHAVIOR } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import { atSeat, clipFor } from './clips.ts';

describe('clipFor', () => {
  it('có clip cho mọi trạng thái', () => {
    for (const s of AGENT_STATES) expect(clipFor(STATE_BEHAVIOR[s].animation, true).clip).toBeTruthy();
  });

  it('nhân viên không nhún nhảy: tư thế đứng/ngồi luôn tĩnh, chỉ bước đi mới chạy clip', () => {
    for (const s of AGENT_STATES) {
      const p = clipFor(STATE_BEHAVIOR[s].animation, true);
      if (p.clip !== 'interact-right' && p.clip !== 'interact-left') expect(p.frozen, s).toBe(true);
    }
    expect(clipFor('walk', true).frozen).toBe(false);
  });

  it('tắt chuyển động trang trí thì dừng cả thao tác tay', () => {
    expect(clipFor('whiteboard', true).frozen).toBe(false);
    expect(clipFor('whiteboard', false).frozen).toBe(true);
  });

  it('offline thì làm mờ', () => {
    expect(clipFor('off', true).dim).toBe(true);
    expect(clipFor('idle', true).dim).toBe(false);
  });

  it('ngồi trên sofa khi rảnh, đứng ở chỗ đứng kể cả khi đang làm', () => {
    expect(atSeat(clipFor('idle', true), 'sit')).toMatchObject({ clip: 'sit', frozen: true });
    expect(atSeat(clipFor('typing', true), 'stand')).toMatchObject({ clip: 'idle', overlay: 'typing' });
    expect(atSeat(clipFor('whiteboard', true), 'sit').clip).toBe('interact-right');
  });
});
