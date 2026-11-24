// Phân chỗ ngồi theo mặt bằng cố định (plan.ts, D-6) và ánh xạ trạng thái → đích.

import { ROLE_HOME_ZONE, STATE_BEHAVIOR, type AgentRole, type AgentState, type ZoneId } from '@delebanana/domain';
import { moduleSeats, planFor, type Seat } from './plan.ts';

export type { Seat } from './plan.ts';

export const ZONE_LABELS: Record<ZoneId, string> = {
  research: 'Research Department',
  creative: 'Creative Department',
  scriptwriting: 'Scriptwriting Department',
  video_studio: 'Video Production Studio',
  meeting_room: 'Meeting Room',
  general_workspace: 'General Workspace',
};

export interface SeatAssignment {
  seat: Seat;
  /** Khu đích thật khi phải ngồi tạm ở General Workspace vì khu đó đầy (nhãn phòng ban, D-6). */
  overflowFrom?: ZoneId;
  /** Đích là chỗ nghỉ (Agent rảnh) — giữ để so khớp lại dù đã phải ngồi tạm bàn của mình. */
  rest?: boolean;
}

export type SeatTarget =
  | { kind: 'zone'; zone: ZoneId; rest?: boolean }
  /** Bàn cố định của Agent trong khu nhà `zone` (hoặc General Workspace/module khi khu đầy). */
  | { kind: 'home'; zone: ZoneId }
  | { kind: 'director' }
  | { kind: 'coordinator' };

/**
 * Đổi `Placement` của trạng thái thành khu/bàn đích; `null` = giữ chỗ hiện tại.
 * Trạng thái làm việc (và offline) luôn về bàn cố định; chỉ họp và idle rời bàn (idle chỉ rời bàn ngoài giờ làm việc,
 * tức khi mọi chiến dịch đã xong). Director/Coordinator có bàn cố định riêng và rảnh thì luôn ngồi đó, không ra Lounge.
 */
export function resolveTarget(state: AgentState, role: AgentRole, atWork = false): SeatTarget | null {
  const p = STATE_BEHAVIOR[state].placement;
  const fixed = role === 'director' || role === 'coordinator';
  switch (p.kind) {
    case 'zone':
      // Agent rảnh: còn chiến dịch dở (giờ làm việc) thì ngồi bàn của mình; xong hết mới ra Lounge (hết chỗ thì ngồi bàn).
      // Director/Coordinator rảnh luôn ngồi bàn riêng.
      if (p.zone === 'general_workspace' && state === 'idle') {
        if (fixed) return { kind: role };
        if (atWork) return { kind: 'home', zone: ROLE_HOME_ZONE[role] };
        return { kind: 'zone', zone: p.zone, rest: true };
      }
      if (p.zone === 'general_workspace' && fixed) return { kind: role };
      return { kind: 'zone', zone: p.zone };
    case 'role_home':
      return fixed ? { kind: role } : { kind: 'home', zone: ROLE_HOME_ZONE[role] };
    case 'director_desk':
      return { kind: 'director' };
    case 'coordinator_desk':
      return { kind: 'coordinator' };
    case 'stay':
      return null;
  }
}

/** Mọi chỗ ngồi (để dựng đồ đạc) khi General Workspace có `moduleCount` module. */
export function allSeats(moduleCount: number): Seat[] {
  return planFor(moduleCount).seats;
}

const BASE = planFor(1).seats;
export const DIRECTOR_SEAT = BASE.find((s) => s.kind === 'director')!;
export const COORDINATOR_SEAT = BASE.find((s) => s.kind === 'coordinator')!;
/** Số chỗ làm việc mỗi khu (không tính Lounge). */
export const ZONE_CAPACITY = (zone: ZoneId) => BASE.filter((s) => s.zone === zone && s.pool === 'work' && s.kind !== 'director' && s.kind !== 'coordinator').length;
export const REST_CAPACITY = BASE.filter((s) => s.pool === 'rest').length;

/**
 * Thứ tự phát "chỗ quen" ở Lounge cho từng người: xen kẽ một ghế booth (lần lượt bốn bàn khác nhau) và một ghế quầy bar
 * (cách đều quanh quầy), để lúc nghỉ mọi người ngồi rải khắp quán chứ không dồn một cụm.
 */
export const FAVORITE_ORDER: readonly Seat[] = (() => {
  const rest = BASE.filter((s) => s.pool === 'rest').sort((p, q) => p.order - q.order);
  const stools = rest.filter((s) => s.id.includes(':stool:'));
  const booths = rest.filter((s) => s.id.includes(':booth:'));
  const tables = Array.from({ length: Math.ceil(booths.length / 4) }, (_, t) => booths.slice(t * 4, t * 4 + 4));
  const boothSpread = [0, 3, 1, 2].flatMap((j) => tables.map((t) => t[j]).filter((x): x is Seat => !!x));
  const stoolSpread = [0, 2, 1, 3].flatMap((start) => stools.filter((_, i) => i % 4 === start));
  const out: Seat[] = [];
  for (let i = 0; i < Math.max(boothSpread.length, stoolSpread.length); i++) {
    if (boothSpread[i]) out.push(boothSpread[i]!);
    if (stoolSpread[i]) out.push(stoolSpread[i]!);
  }
  return out;
})();

/**
 * Giữ chỗ ngồi cho từng Agent. Mỗi Agent có một bàn cố định (`register`, theo thứ tự roster): trong khu nhà của vai trò, khu
 * đầy thì bàn General Workspace kèm nhãn phòng ban (D-6), hết nữa thì mở thêm module bàn. Bàn cố định không bao giờ trả về
 * pool khi Agent đi họp hay ra Lounge, nên không Agent nào chiếm được; chỉ ghế họp và ghế Lounge được cho mượn.
 */
export class SeatAllocator {
  private readonly free = new Map<ZoneId, Seat[]>();
  private readonly rest: Seat[] = [];
  private readonly taken = new Map<string, SeatAssignment>();
  private readonly homes = new Map<string, SeatAssignment>();
  private readonly fixedOwner = new Map<'director' | 'coordinator', string>();
  /** Chỗ quen ở Lounge của từng người (cố định theo thứ tự đăng ký). */
  private readonly favorites = new Map<string, Seat>();
  private generalModules = 1;

  constructor() {
    for (const s of BASE) {
      if (s.kind === 'director' || s.kind === 'coordinator') continue;
      if (s.pool === 'rest') this.rest.push(s);
      else this.free.set(s.zone, [...(this.free.get(s.zone) ?? []), s]);
    }
  }

  get moduleCount(): number {
    return this.generalModules;
  }

  assignmentOf(agentId: string): SeatAssignment | undefined {
    return this.taken.get(agentId);
  }

  /** Bàn cố định của Agent (chưa đăng ký thì `undefined`). */
  homeOf(agentId: string): SeatAssignment | undefined {
    return this.homes.get(agentId);
  }

  /** Gán bàn cố định cho Agent; gọi theo thứ tự roster ngay khi dựng để kết quả tất định. Gọi lại trả bàn cũ. */
  register(agentId: string, role: AgentRole): SeatAssignment {
    const fixed = role === 'director' || role === 'coordinator';
    // Mỗi nhân viên nhận một chỗ quen chưa ai nhận; Giám đốc, trưởng phòng không ra Lounge nên không có chỗ quen.
    if (!fixed && !this.favorites.has(agentId)) {
      const taken = new Set(this.favorites.values());
      const fav = FAVORITE_ORDER.find((s) => !taken.has(s));
      if (fav) this.favorites.set(agentId, fav);
    }
    return this.homeFor(agentId, fixed ? role : ROLE_HOME_ZONE[role]);
  }

  /** Đặt Agent vào đích; `null` giữ chỗ cũ (hoặc Lounge nếu chưa có chỗ). */
  place(agentId: string, target: SeatTarget | null): SeatAssignment {
    const current = this.taken.get(agentId);
    if (target === null) return current ?? this.place(agentId, { kind: 'zone', zone: 'general_workspace', rest: true });
    if (current && this.sameTarget(agentId, current, target)) return current;

    this.leave(agentId);
    let a: SeatAssignment;
    if (target.kind !== 'zone') {
      a = this.homeFor(agentId, target.kind === 'home' ? target.zone : target.kind);
    } else if (target.rest) {
      // Ngồi chỗ quen nếu còn trống; không thì chỗ trống đầu tiên.
      const fav = this.favorites.get(agentId);
      const i = fav ? this.rest.indexOf(fav) : -1;
      const seat = i >= 0 ? this.rest.splice(i, 1)[0] : this.rest.shift();
      // Lounge hết chỗ: ngồi bàn của mình, không mở module.
      a = seat ? { seat, rest: true } : { ...this.homeFor(agentId, 'general_workspace'), rest: true };
    } else {
      const seat = this.free.get(target.zone)!.shift();
      a = seat ? { seat } : { seat: this.takeGeneralDesk(), overflowFrom: target.zone };
    }
    this.taken.set(agentId, a);
    return a;
  }

  /** Xoá hẳn Agent (rời roster): trả cả bàn cố định về pool. */
  release(agentId: string): void {
    this.leave(agentId);
    this.favorites.delete(agentId);
    const home = this.homes.get(agentId);
    if (!home) return;
    this.homes.delete(agentId);
    if (home.seat.kind === 'director' || home.seat.kind === 'coordinator') this.fixedOwner.delete(home.seat.kind);
    else this.giveBack(home.seat);
  }

  /** Rời chỗ hiện tại; chỗ mượn (họp, Lounge) về pool, bàn cố định giữ nguyên chủ. */
  private leave(agentId: string): void {
    const a = this.taken.get(agentId);
    if (!a) return;
    this.taken.delete(agentId);
    if (a.seat !== this.homes.get(agentId)?.seat) this.giveBack(a.seat);
  }

  private giveBack(seat: Seat): void {
    const list = seat.pool === 'rest' ? this.rest : this.free.get(seat.zone)!;
    list.push(seat);
    list.sort((p, q) => p.order - q.order);
  }

  private homeFor(agentId: string, want: 'director' | 'coordinator' | ZoneId): SeatAssignment {
    const have = this.homes.get(agentId);
    if (have) return have;
    let a: SeatAssignment;
    if (want === 'director' || want === 'coordinator') {
      // Bàn cố định đã có chủ: Agent thứ hai cùng vai trò ngồi bàn General Workspace.
      if (this.fixedOwner.has(want)) a = { seat: this.takeGeneralDesk() };
      else {
        this.fixedOwner.set(want, agentId);
        a = { seat: want === 'director' ? DIRECTOR_SEAT : COORDINATOR_SEAT };
      }
    } else {
      const seat = this.free.get(want)?.shift();
      a = seat ? { seat } : { seat: this.takeGeneralDesk(), ...(want === 'general_workspace' ? {} : { overflowFrom: want }) };
    }
    this.homes.set(agentId, a);
    return a;
  }

  /** Bàn trống ở General Workspace; hết thì mở thêm module. */
  private takeGeneralDesk(): Seat {
    const work = this.free.get('general_workspace')!;
    if (work.length === 0) {
      work.push(...moduleSeats(this.generalModules));
      this.generalModules++;
    }
    return work.shift()!;
  }

  private sameTarget(agentId: string, a: SeatAssignment, t: SeatTarget): boolean {
    const home = this.homes.get(agentId);
    if (t.kind !== 'zone') return home !== undefined && a === home;
    if (t.rest) return a.rest === true;
    return a !== home && !a.rest && (a.overflowFrom ?? a.seat.zone) === t.zone;
  }
}
