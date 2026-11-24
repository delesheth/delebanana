import { describe, expect, it } from 'vitest';
import { checkReelsSpec } from './publish.ts';

const ok = { durationSeconds: 30, width: 1080, height: 1920 };

describe('checkReelsSpec', () => {
  it('mp4 9:16 hợp lệ', () => expect(checkReelsSpec(ok, 'video/mp4')).toEqual([]));
  it('mov bị chặn có lý do', () => expect(checkReelsSpec(ok, 'video/quicktime')[0]).toMatch(/chỉ nhận MP4/));
  it('tính độ xoay: 1920x1080 xoay 90 là dọc', () => expect(checkReelsSpec({ ...ok, width: 1920, height: 1080, rotation: 90 }, 'video/mp4')).toEqual([]));
  it('ngang không xoay bị từ chối', () => expect(checkReelsSpec({ ...ok, width: 1920, height: 1080 }, 'video/mp4').join()).toMatch(/9:16/));
  it('cận thời lượng 3–90 giây', () => {
    expect(checkReelsSpec({ ...ok, durationSeconds: 2.9 }, 'video/mp4').join()).toMatch(/2\.9 giây/);
    expect(checkReelsSpec({ ...ok, durationSeconds: 90.1 }, 'video/mp4').join()).toMatch(/90\.1 giây/);
    expect(checkReelsSpec({ ...ok, durationSeconds: 3 }, 'video/mp4')).toEqual([]);
    expect(checkReelsSpec({ ...ok, durationSeconds: 90 }, 'video/mp4')).toEqual([]);
  });
  it('độ phân giải dưới 540x960', () => expect(checkReelsSpec({ ...ok, width: 538, height: 958 }, 'video/mp4').join()).toMatch(/538x958 nhỏ hơn tối thiểu 540x960/));
  it('thiếu metadata', () => expect(checkReelsSpec(null, 'video/mp4').length).toBe(2));
});
