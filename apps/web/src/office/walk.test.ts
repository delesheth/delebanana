import { describe, expect, it } from 'vitest';
import { ROOMS, U_WINGS, planFor, rectCenter, wallSegments, type Point, type Seat } from './plan.ts';
import { gridFor, walkPath } from './walk.ts';

const plan = planFor(1);
const grid = gridFor(1);
const plan2 = planFor(2);

/** Đoạn giữa (bỏ bước đứng dậy/ngồi xuống ở hai đầu) phải nằm trọn trên ô đi được. */
function assertWalkable(from: Seat, to: Seat, path: Point[]) {
  const pts = [from as Point, ...path];
  const firstFree = from.approach.x === from.x && from.approach.z === from.z ? 0 : 1;
  const lastFree = to.approach.x === to.x && to.approach.z === to.z ? pts.length - 1 : pts.length - 2;
  for (let i = firstFree; i < lastFree; i++) expect(grid.clear(pts[i]!, pts[i + 1]!), `${from.id} → ${to.id} đoạn ${i}`).toBe(true);
}

describe('mặt bằng', () => {
  it('phòng họp ở trung tâm, có 4 cửa B/Đ/N/T', () => {
    const meeting = ROOMS.find((r) => r.id === 'meeting_room')!;
    expect(rectCenter(meeting.rect)).toEqual({ x: 0, z: 0 });
    expect(meeting.doors.map((d) => d.side).sort()).toEqual(['e', 'n', 's', 'w']);
  });

  it('mọi đồ đạc và chỗ ngồi nằm trong một phòng', () => {
    for (const s of plan.seats) {
      const r = plan.rooms.find((q) => q.id === s.room)!.rect;
      expect(s.x > r.x0 && s.x < r.x1 && s.z > r.z0 && s.z < r.z1, s.id).toBe(true);
    }
  });

  it('các phòng kê đối xứng qua trục giữa phòng', () => {
    for (const room of plan2.rooms) {
      if (room.id === 'video_studio' || room.id === 'lounge') continue; // phòng quay (trục dọc) và quầy bar có chủ đích lệch
      // Gương qua trục đi qua cửa: cửa ở cạnh n/s → gương theo x; cửa ở cạnh e/w → gương theo z.
      const c = rectCenter(room.rect);
      const byX = room.doors[0]!.side === 'n' || room.doors[0]!.side === 's';
      const xs = plan2.seats.filter((s) => s.room === room.id).map((s) => Math.round(((byX ? s.x - c.x : s.z - c.z)) * 100) / 100 + 0);
      expect(xs.map((x) => 0 - x + 0).sort((a, b) => a - b), room.id).toEqual([...xs].sort((a, b) => a - b));
    }
  });

  it('Research, Scriptwriting, Creative là phòng riêng một bàn; Video Studio giữ chỗ đứng máy quay + 3 chỗ sofa; General 3 bàn; module 4', () => {
    const counts = new Map<string, number>();
    for (const s of plan2.seats) if (s.pool === 'work' && s.room !== 'meeting_room') counts.set(s.room, (counts.get(s.room) ?? 0) + 1);
    for (const room of ['research', 'scriptwriting', 'creative']) expect(counts.get(room), room).toBe(1);
    expect(counts.get('video_studio')).toBe(4);
    expect(counts.get('general_workspace')).toBe(3);
    expect(counts.get('general:1')).toBe(4);
  });

  it('Creative và General Workspace: mọi chỗ làm việc quay mặt về cửa phòng', () => {
    for (const [id, facing] of [['creative', Math.PI / 2], ['general_workspace', -Math.PI / 2]] as const) {
      const room = plan.rooms.find((r) => r.id === id)!;
      const door = room.doors[0]!;
      const doorX = door.side === 'e' ? room.rect.x1 : room.rect.x0;
      const seats = plan.seats.filter((s) => s.room === id);
      expect(seats).toHaveLength(id === 'creative' ? 1 : 3);
      for (const s of seats) {
        expect(s.facing, s.id).toBe(facing);
        // Vector từ chỗ ngồi tới cửa cùng chiều hướng nhìn (sin(facing) = thành phần x).
        expect(Math.sign(doorX - s.x), s.id).toBe(Math.sign(Math.sin(s.facing)));
      }
    }
  });

  it('bàn trưởng phòng chữ U có hai cánh làm vật cản', () => {
    const seat = plan.seats.find((s) => s.kind === 'coordinator')!;
    const wing = U_WINGS.coordinator!;
    const rot = seat.facing;
    expect(rot).toBe(-Math.PI / 2);
    for (const sgn of [-1, 1]) {
      // rot = -π/2: cục bộ (lx, lz) → thế giới (x - lz, z + lx).
      const cx = seat.x - wing.z;
      const cz = seat.z + sgn * wing.x;
      expect(plan.obstacles.some((o) => Math.abs(o.x - cx) < 1e-6 && Math.abs(o.z - cz) < 1e-6 && Math.abs(o.hx - wing.hd) < 1e-6 && Math.abs(o.hz - wing.hw) < 1e-6)).toBe(true);
    }
    expect(plan.items.some((i) => i.kind === 'workstation' && i.style === 'coordinator')).toBe(true);
  });

  it('điểm tiếp cận của mọi chỗ ngồi đứng được', () => {
    for (const s of plan.seats) expect(grid.free(s.approach), s.id).toBe(true);
  });

  it('cửa phòng thông ra hành lang', () => {
    for (const room of ROOMS) {
      const c = rectCenter(room.rect);
      expect(grid.findPath(c.x === 0 && c.z === 0 ? { x: 0, z: 3.4 } : c, { x: 0, z: -5.5 }), room.id).not.toBeNull();
    }
  });
});

describe('walkPath', () => {
  const seats = plan.seats;

  it('mọi cặp chỗ ngồi đều có lối, không xuyên vách hay đồ đạc', () => {
    for (let i = 0; i < seats.length; i += 3)
      for (let j = 1; j < seats.length; j += 5) {
        const from = seats[i]!;
        const to = seats[j]!;
        if (from === to) continue;
        const path = walkPath(from, from, to, 1);
        expect(path.at(-1)).toEqual({ x: to.x, z: to.z });
        assertWalkable(from, to, path);
      }
  });

  it('chỉ băng qua vách ở khe cửa', () => {
    const from = seats.find((s) => s.room === 'research')!;
    const to = seats.find((s) => s.room === 'lounge')!;
    const path = [from.approach, ...walkPath(from, from, to, 1).slice(0, -1)];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      for (const room of plan.rooms)
        for (const w of wallSegments(room)) {
          // Giao của đoạn đi với đoạn vách (thẳng trục).
          if (w.z0 === w.z1 && (a.z - w.z0) * (b.z - w.z0) < 0) {
            const x = a.x + ((w.z0 - a.z) / (b.z - a.z)) * (b.x - a.x);
            expect(x < w.x0 || x > w.x1, `${room.id} vách ${w.side}`).toBe(true);
          }
          if (w.x0 === w.x1 && (a.x - w.x0) * (b.x - w.x0) < 0) {
            const z = a.z + ((w.x0 - a.x) / (b.x - a.x)) * (b.z - a.z);
            expect(z < w.z0 || z > w.z1, `${room.id} vách ${w.side}`).toBe(true);
          }
        }
    }
  });

  it('module bàn mở rộng cũng đi tới được', () => {
    const p3 = planFor(3);
    const mod = p3.seats.find((s) => s.room === 'general:2')!;
    const from = p3.seats.find((s) => s.room === 'research')!;
    expect(walkPath(from, from, mod, 3).at(-1)).toEqual({ x: mod.x, z: mod.z });
  });
});
