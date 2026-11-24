import type { ServerSnapshot } from '@delebanana/domain';
import { describe, expect, it } from 'vitest';
import { ENTRANCE, office } from './officeStore.ts';

const ROSTER: ServerSnapshot['roster'] = [
  { id: 'p-dir', workspaceId: 'w', name: 'Dele', role: 'director', title: 'Director' },
  { id: 'p-coord', workspaceId: 'w', name: 'TC', role: 'coordinator', title: 'Coordinator' },
  { id: 'p-res', workspaceId: 'w', name: 'An', role: 'researcher', title: 'Researcher' },
];
const snap = (seq: number): ServerSnapshot => ({
  seq,
  workspaces: [{ id: 'w', name: 'W' }],
  roster: ROSTER,
  agents: Object.fromEntries(ROSTER.map((r) => [r.id, { state: 'idle', since: 1 }])),
});

describe('tắt / bật văn phòng theo server', () => {
  it('kết nối lần đầu: sáng đèn, mọi người ngồi sẵn tại chỗ', () => {
    office.setConnection('connecting');
    office.loadSnapshot(snap(1));
    office.setConnection('online');
    expect(office.lightsOn()).toBe(true);
    expect(office.runtimes.every((rt) => rt.arrived)).toBe(true);
  });

  it('bấm Stop: tắt đèn ngay; mất server vẫn tối; online lại thì sáng và nhân viên đi từ cửa chính vào lần lượt', () => {
    office.beginShutdown();
    expect(office.lightsOn()).toBe(false);
    office.setConnection('offline');
    expect(office.lightsOn()).toBe(false);

    office.loadSnapshot(snap(2));
    office.setConnection('online');
    expect(office.lightsOn()).toBe(true);
    for (const rt of office.runtimes) {
      expect(rt.arrived).toBe(false);
      expect(Math.abs(rt.mover.z - ENTRANCE.z)).toBeLessThan(1e-6);
    }
    // Người đầu đi trước, người sau còn xếp hàng.
    office.update(0.1);
    expect(office.runtimes[0]!.mover.z).toBeLessThan(ENTRANCE.z);
    expect(office.runtimes[2]!.mover.z).toBe(ENTRANCE.z);
    for (let i = 0; i < 400; i++) office.update(0.1);
    expect(office.runtimes.every((rt) => rt.arrived)).toBe(true);
  });

  it('mất kết nối rồi nối lại (không bấm Stop) cũng tắt đèn rồi cho đi vào', () => {
    office.setConnection('offline');
    expect(office.lightsOn()).toBe(false);
    office.loadSnapshot(snap(3));
    expect(office.runtimes.some((rt) => !rt.arrived)).toBe(true);
  });
});

describe('họp khi trưởng phòng chia việc / duyệt', () => {
  const roster: ServerSnapshot['roster'] = [
    { id: 'h-dir', workspaceId: 'w', name: 'Dele', role: 'director', title: 'Director' },
    { id: 'h-coord', workspaceId: 'w', name: 'TC', role: 'coordinator', title: 'Coordinator' },
    { id: 'h-res', workspaceId: 'w', name: 'An', role: 'researcher', title: 'Researcher' },
    { id: 'h-cre', workspaceId: 'w', name: 'Bình', role: 'creative', title: 'Creative' },
  ];
  const snapOf = (seq: number, coord: string, res = 'idle'): ServerSnapshot => ({
    seq,
    workspaces: [{ id: 'w', name: 'W' }],
    roster,
    agents: { 'h-dir': { state: 'idle', since: 1 }, 'h-coord': { state: coord as never, since: 1 }, 'h-res': { state: res as never, since: 1 }, 'h-cre': { state: 'idle', since: 1 } },
  });
  const room = (id: string) => office.runtime(id)!.assignment.seat.room;
  const ev = (seq: number, id: string, state: string) =>
    ({ seq, at: seq, type: 'agent.state_changed', workspaceId: 'w', entity: { kind: 'agent', id }, actor: 'system', data: { state } }) as never;

  it('trưởng phòng bắt đầu chia việc → cả đội (trừ Giám đốc) vào Meeting Room; xong thì về chỗ', () => {
    office.setConnection('online');
    // Trưởng phòng chỉ chia việc khi còn chiến dịch dở (giờ làm việc): Giám đốc rảnh ngồi bàn riêng.
    office.setWorkday(true);
    office.loadSnapshot(snapOf(10, 'idle', 'researching'));
    expect(room('h-res')).toBe('research');
    office.receive(ev(11, 'h-coord', 'planning'));
    expect(['h-coord', 'h-res', 'h-cre'].map(room)).toEqual(['meeting_room', 'meeting_room', 'meeting_room']);
    expect(room('h-dir')).toBe('director');
    // Người rảnh ngồi họp chứ không ngồi im như lúc nghỉ.
    expect(office.runtime('h-cre')!.animation).toBe('meeting');
    office.receive(ev(12, 'h-coord', 'idle'));
    expect(room('h-res')).toBe('research');
    expect(room('h-coord')).toBe('general_workspace');
    // Hết giờ làm việc: nhân viên rảnh ra Lounge, Giám đốc và trưởng phòng vẫn ngồi bàn riêng.
    office.setWorkday(false);
    expect([room('h-dir'), room('h-coord'), room('h-cre')]).toEqual(['director', 'general_workspace', 'lounge']);
  });

  it('duyệt bài (reviewing) cũng họp; nạp snapshot giữa buổi họp thì vẫn ở phòng họp', () => {
    office.loadSnapshot(snapOf(20, 'reviewing'));
    expect(room('h-cre')).toBe('meeting_room');
  });
});
