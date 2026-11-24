import { describe, expect, it } from 'vitest';
import { ROLE_HOME_ZONE, type ZoneId } from '@delebanana/domain';
import { createRoster } from './rosterFixture.ts';
import { COORDINATOR_SEAT, DIRECTOR_SEAT, REST_CAPACITY, SeatAllocator, ZONE_CAPACITY, resolveTarget } from './layout.ts';

describe('resolveTarget', () => {
  it('trạng thái làm việc về bàn cố định, không sang phòng khác theo trạng thái', () => {
    expect(resolveTarget('researching', 'researcher')).toEqual({ kind: 'home', zone: 'research' });
    expect(resolveTarget('assigned', 'video_producer')).toEqual({ kind: 'home', zone: 'video_studio' });
    for (const role of ['creative', 'video_producer', 'publisher'] as const)
      expect(resolveTarget('writing', role)).toEqual({ kind: 'home', zone: ROLE_HOME_ZONE[role] });
    expect(resolveTarget('conversing', 'director')).toEqual({ kind: 'director' });
    expect(resolveTarget('error', 'creative')).toBeNull();
    expect(resolveTarget('in_meeting', 'creative')).toEqual({ kind: 'zone', zone: 'meeting_room' });
  });

  it('Agent rảnh ra Lounge, Agent đăng bài và offline ở bàn của mình', () => {
    expect(resolveTarget('idle', 'researcher')).toEqual({ kind: 'zone', zone: 'general_workspace', rest: true });
    expect(resolveTarget('publishing', 'publisher')).toEqual({ kind: 'home', zone: 'general_workspace' });
    expect(resolveTarget('offline', 'publisher')).toEqual({ kind: 'home', zone: 'general_workspace' });
  });

  it('Director/Coordinator rảnh luôn ngồi bàn riêng, không ra Lounge; offline, họp như cũ', () => {
    expect(resolveTarget('idle', 'director')).toEqual({ kind: 'director' });
    expect(resolveTarget('idle', 'coordinator')).toEqual({ kind: 'coordinator' });
    expect(resolveTarget('offline', 'coordinator')).toEqual({ kind: 'coordinator' });
    expect(resolveTarget('in_meeting', 'director')).toEqual({ kind: 'zone', zone: 'meeting_room' });
  });
});

const REST = { kind: 'zone', zone: 'general_workspace', rest: true } as const;
const homeOf = (zone: ZoneId) => ({ kind: 'home', zone }) as const;

describe('SeatAllocator', () => {
  it('bàn Director nằm trong phòng Giám đốc', () => {
    expect(DIRECTOR_SEAT.room).toBe('director');
  });

  it('register gán mỗi Agent một bàn riêng trong khu nhà của vai trò', () => {
    const a = new SeatAllocator();
    const r = ['researcher', 'analyst', 'creative', 'video_producer'] as const;
    const seats = r.map((role, i) => a.register(`a${i}`, role).seat);
    expect(new Set(seats.map((s) => s.id)).size).toBe(4);
    // Analyst ngồi General Workspace (D-18 sửa 2026-11-23); mỗi phòng chuyên môn là phòng riêng một người.
    expect(seats.map((s) => s.room)).toEqual(['research', 'general_workspace', 'creative', 'video_studio']);
    expect(a.register('a0', 'researcher').seat).toBe(seats[0]);
    expect(a.register('d', 'director').seat).toBe(DIRECTOR_SEAT);
    expect(a.register('c', 'coordinator').seat.kind).toBe('coordinator');
  });

  it('khu nhà đầy thì bàn General Workspace kèm nhãn phòng ban (D-6)', () => {
    const a = new SeatAllocator();
    for (let i = 0; i < ZONE_CAPACITY('video_studio'); i++) a.register(`v${i}`, 'video_producer');
    const over = a.register('overflow', 'video_producer');
    expect(over.seat.zone).toBe('general_workspace');
    expect(over.seat.pool).toBe('work');
    expect(over.overflowFrom).toBe('video_studio');
    expect(a.place('overflow', homeOf('video_studio'))).toBe(over);
  });

  it('creative/video_producer/publisher writing ở lại bàn của mình', () => {
    const a = new SeatAllocator();
    for (const role of ['creative', 'video_producer', 'publisher'] as const) {
      const home = a.register(role, role);
      const placed = a.place(role, resolveTarget('writing', role));
      expect(placed).toBe(home);
      expect(placed.seat.room).not.toBe('scriptwriting');
    }
  });

  it('họp và rảnh xong về đúng bàn cũ; bàn của Agent đang họp không bị lấy', () => {
    const a = new SeatAllocator();
    const home = a.register('r1', 'researcher');
    a.place('r1', resolveTarget('researching', 'researcher'));
    const meeting = a.place('r1', resolveTarget('in_meeting', 'researcher'));
    expect(meeting.seat.room).toBe('meeting_room');
    for (let i = 0; i < 10; i++) expect(a.register(`x${i}`, 'researcher').seat.id).not.toBe(home.seat.id);
    expect(a.place('r1', resolveTarget('analyzing', 'researcher'))).toBe(home);
    expect(a.place('r1', REST).seat.room).toBe('lounge');
    expect(a.place('r1', resolveTarget('writing', 'researcher'))).toBe(home);
  });

  it('Lounge đầy thì Agent rảnh ngồi bàn của mình, không mở module', () => {
    const a = new SeatAllocator();
    const n = REST_CAPACITY + 1;
    const ids = Array.from({ length: n }, (_, i) => `g${i}`);
    for (const id of ids) a.register(id, 'publisher');
    const moduleCount = a.moduleCount;
    const placed = ids.map((id) => a.place(id, REST));
    expect(placed.filter((p) => p.seat.room === 'lounge')).toHaveLength(REST_CAPACITY);
    const last = placed.at(-1)!;
    expect(last.seat).toBe(a.homeOf(ids.at(-1)!)!.seat);
    expect(a.place(ids.at(-1)!, REST)).toBe(last);
    expect(a.moduleCount).toBe(moduleCount);
  });

  it('giữ nguyên chỗ khi đích không đổi', () => {
    const a = new SeatAllocator();
    const first = a.place('r1', homeOf('research'));
    expect(a.place('r1', homeOf('research'))).toBe(first);
    expect(a.place('r1', null)).toBe(first);
  });

  it('đội mặc định 8 người: mỗi phòng chuyên môn đúng một người, Publisher + Analyst ở General Workspace, không mở module', () => {
    const a = new SeatAllocator();
    const roster = createRoster(8);
    for (const p of roster) a.register(p.id, p.role);
    for (const p of roster) a.place(p.id, resolveTarget('idle', p.role));
    expect(a.moduleCount).toBe(1);
    expect(new Set(roster.map((p) => a.homeOf(p.id)!.seat.id)).size).toBe(8);
    const roomOf = (role: string) => roster.filter((p) => p.role === role).map((p) => a.homeOf(p.id)!.seat.room);
    for (const [role, room] of [['researcher', 'research'], ['creative', 'creative'], ['scriptwriter', 'scriptwriting'], ['video_producer', 'video_studio']] as const)
      expect(roomOf(role)).toEqual([room]);
    expect([...roomOf('publisher'), ...roomOf('analyst')]).toEqual(['general_workspace', 'general_workspace']);
    expect(new Set(roster.map((p) => a.assignmentOf(p.id)!.seat.id)).size).toBe(8);
    expect(REST_CAPACITY).toBeGreaterThanOrEqual(18);
  });

  it('người thứ 9 (Research đã có người) có bàn ở module kèm nhãn phòng ban', () => {
    const a = new SeatAllocator();
    const roster = createRoster(9);
    for (const p of roster) a.register(p.id, p.role);
    const last = a.homeOf(roster.at(-1)!.id)!;
    expect(last.overflowFrom).toBe(ZONE_OF[roster.at(-1)!.role]);
    expect(last.seat.zone).toBe('general_workspace');
    expect(new Set(roster.map((p) => a.homeOf(p.id)!.seat.id)).size).toBe(9);
    expect(a.moduleCount).toBe(2);
  });

  it('vẫn mở thêm module khi General Workspace đầy, không giới hạn cứng (D-5)', () => {
    const a = new SeatAllocator();
    const ids = new Set<string>();
    for (let i = 0; i < 60; i++) ids.add(a.register(`g${i}`, 'publisher').seat.id);
    expect(ids.size).toBe(60);
    expect(a.moduleCount).toBeGreaterThan(1);
  });

  it('bàn Director cố định cho một Agent; người thứ hai sang General Workspace', () => {
    const a = new SeatAllocator();
    expect(a.place('d1', { kind: 'director' }).seat).toBe(DIRECTOR_SEAT);
    expect(a.place('d2', { kind: 'director' }).seat.zone).toBe('general_workspace');
  });
});

const ZONE_OF = ROLE_HOME_ZONE;

describe('giờ làm việc', () => {
  it('nhân viên rảnh: còn chiến dịch dở thì về bàn của mình; xong hết mới ra Lounge', () => {
    expect(resolveTarget('idle', 'researcher', true)).toEqual({ kind: 'home', zone: 'research' });
    expect(resolveTarget('idle', 'publisher', true)).toEqual({ kind: 'home', zone: 'general_workspace' });
    expect(resolveTarget('idle', 'researcher', false)).toEqual({ kind: 'zone', zone: 'general_workspace', rest: true });
    // Giám đốc, trưởng phòng rảnh trong giờ làm việc ngồi bàn riêng.
    expect(resolveTarget('idle', 'director', true)).toEqual({ kind: 'director' });
    expect(resolveTarget('idle', 'coordinator', true)).toEqual({ kind: 'coordinator' });
  });
});

describe('chỗ quen ở Lounge', () => {
  it('mỗi người nghỉ ở đúng chỗ quen của mình, rải giữa bàn booth và ghế quầy', () => {
    const roster = createRoster(8);
    const seatsOf = () => {
      const a = new SeatAllocator();
      for (const p of roster) a.register(p.id, p.role);
      return roster.filter((p) => p.role !== 'director' && p.role !== 'coordinator').map((p) => a.place(p.id, REST).seat);
    };
    const first = seatsOf();
    // Lần nào cũng như nhau (chỗ quen cố định).
    expect(seatsOf().map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(new Set(first.map((s) => s.id)).size).toBe(first.length);
    const booths = first.filter((s) => s.id.includes(':booth:'));
    const stools = first.filter((s) => s.id.includes(':stool:'));
    expect(booths.length).toBeGreaterThanOrEqual(2);
    expect(stools.length).toBeGreaterThanOrEqual(2);
    // Người ngồi booth mỗi người một bàn khác nhau.
    expect(new Set(booths.map((s) => s.id.split(':').slice(3, 5).join(':'))).size).toBe(booths.length);
  });

  it('đi làm rồi nghỉ lại thì về đúng chỗ quen; chỗ quen có người thì ngồi chỗ khác', () => {
    const a = new SeatAllocator();
    a.register('x', 'researcher');
    a.register('y', 'creative');
    const fav = a.place('x', REST).seat;
    a.place('x', homeOf('research'));
    expect(a.place('x', REST).seat).toBe(fav);
    a.place('x', homeOf('research'));
    const other = a.place('y', REST).seat;
    expect(other).not.toBe(fav);
  });
});

describe('Director/Coordinator không ra Lounge', () => {
  it('cả đội 8 người rảnh ngoài giờ làm việc: nhân viên ra Lounge, Giám đốc và trưởng phòng ngồi bàn riêng', () => {
    const roster = createRoster(8);
    const a = new SeatAllocator();
    for (const p of roster) a.register(p.id, p.role);
    for (const p of roster) {
      const s = a.place(p.id, resolveTarget('idle', p.role));
      if (p.role === 'director') expect(s.seat).toBe(DIRECTOR_SEAT);
      else if (p.role === 'coordinator') expect(s.seat).toBe(COORDINATOR_SEAT);
      else expect(s.rest && s.seat.pool === 'rest').toBe(true);
    }
  });
});
