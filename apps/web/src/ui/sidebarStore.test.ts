import { beforeEach, describe, expect, it } from 'vitest';
import { cameraFocus } from '../sim/cameraFocus.ts';
import { sidebars } from './sidebarStore.ts';

beforeEach(() => {
  sidebars.close('left');
  sidebars.close('right');
  cameraFocus.set('all');
});

describe('sidebars', () => {
  it('mặc định đóng; mở/đóng từng bên độc lập', () => {
    expect(sidebars.get()).toEqual({ left: false, right: false });
    sidebars.open('left');
    sidebars.open('right');
    expect(sidebars.get()).toEqual({ left: true, right: true });
    sidebars.close('left');
    expect(sidebars.get()).toEqual({ left: false, right: true });
  });

  it('mở chat Director → camera về Director Office; mở Campaign không đổi camera', () => {
    sidebars.open('left');
    expect(cameraFocus.get().focus).toBe('all');
    sidebars.open('right');
    expect(cameraFocus.get().focus).toBe('director');
  });

  it('Full Office: đóng cả hai tab, camera về toàn văn phòng', () => {
    sidebars.open('left');
    sidebars.open('right');
    sidebars.closeAll();
    expect(sidebars.get()).toEqual({ left: false, right: false });
    expect(cameraFocus.get().focus).toBe('all');
  });

  it('đóng tab → camera về toàn văn phòng', () => {
    sidebars.open('right');
    sidebars.close('right');
    expect(cameraFocus.get().focus).toBe('all');
  });
});
