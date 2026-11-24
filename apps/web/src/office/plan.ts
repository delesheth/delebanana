// Mặt bằng cố định của văn phòng (D-6): phòng, cửa, hành lang, đồ đạc (kèm diện tích chiếm chỗ để tìm đường) và chỗ ngồi.
// Thuần dữ liệu, không phụ thuộc three.js. Mặt sàn là mặt phẳng XZ, đơn vị ~ 1 m; bắc = -Z (tường cao), camera nhìn từ nam.
//
//   ┌ Research ──┬ Director ┬ Scriptwriting ┐      Phòng họp ở trung tâm, 4 cửa B/Đ/N/T ra hành lang vòng.
//   └────────────┴──────────┴───────────────┘      Mọi phòng kê đồ đối xứng qua trục giữa phòng.
//   ┌ Creative ┐   ┌ Meeting ┐   ┌ General ┐
//   └──────────┘   └─────────┘   └─────────┘
//   ┌ Video Studio ─────┐ lối ┌ Lounge ───────┐   Lounge: chỗ của Agent rảnh (vẫn thuộc khu General Workspace).
//   └───────────────────┘ vào └───────────────┘

import type { ZoneId } from '@delebanana/domain';

export interface Point {
  x: number;
  z: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Side = 'n' | 's' | 'e' | 'w';
export interface Door {
  side: Side;
  /** Toạ độ tâm cửa dọc theo cạnh (x với cạnh n/s, z với cạnh e/w). */
  at: number;
}

export type RoomId =
  | 'research'
  | 'director'
  | 'scriptwriting'
  | 'creative'
  | 'meeting_room'
  | 'general_workspace'
  | 'video_studio'
  | 'lounge'
  | `general:${number}`;

export interface Room {
  id: RoomId;
  label: string;
  rect: Rect;
  doors: Door[];
}

export const DOOR_WIDTH = 2;

const N_ROW = { z0: -15.5, z1: -6.5 };
const M_ROW = { z0: -4.5, z1: 4.5 };
const S_ROW = { z0: 6.5, z1: 15.5 };
/** Hàng module bàn mở rộng (D-6), phía nam tòa nhà, chỉ xuất hiện khi General Workspace và Lounge đều đầy. */
const MODULE_ROW = { z0: 17.5, z1: 26.5 };

export const ROOMS: readonly Room[] = [
  { id: 'research', label: 'Research Department', rect: { x0: -17, x1: -5, ...N_ROW }, doors: [{ side: 's', at: -11 }] },
  { id: 'director', label: 'Director Office', rect: { x0: -5, x1: 5, ...N_ROW }, doors: [{ side: 's', at: 0 }] },
  { id: 'scriptwriting', label: 'Scriptwriting Department', rect: { x0: 5, x1: 17, ...N_ROW }, doors: [{ side: 's', at: 11 }] },
  { id: 'creative', label: 'Creative Department', rect: { x0: -17, x1: -7, ...M_ROW }, doors: [{ side: 'e', at: 0 }] },
  {
    id: 'meeting_room',
    label: 'Meeting Room',
    rect: { x0: -5, x1: 5, ...M_ROW },
    doors: [
      { side: 'n', at: 0 },
      { side: 's', at: 0 },
      { side: 'e', at: 0 },
      { side: 'w', at: 0 },
    ],
  },
  { id: 'general_workspace', label: 'General Workspace', rect: { x0: 7, x1: 17, ...M_ROW }, doors: [{ side: 'w', at: 0 }] },
  { id: 'video_studio', label: 'Video Production Studio', rect: { x0: -17, x1: -1, ...S_ROW }, doors: [{ side: 'n', at: -9 }] },
  { id: 'lounge', label: 'Lounge Bar', rect: { x0: 1, x1: 17, ...S_ROW }, doors: [{ side: 'n', at: 9 }] },
];

/** Khung tòa nhà chính (tường ngoài bắc/tây/đông, mặt nam để trống cho camera). */
export const BUILDING: Rect = { x0: -17, x1: 17, z0: N_ROW.z0, z1: S_ROW.z1 };

/** Module k ≥ 1: xen kẽ đông/tây của lối vào, xa dần. */
export function moduleRoom(k: number): Room {
  const col = Math.floor((k - 1) / 2);
  const x0 = k % 2 === 1 ? 1 + col * 12 : -11 - col * 12;
  const rect = { x0, x1: x0 + 10, ...MODULE_ROW };
  return { id: `general:${k}`, label: `General Workspace ${k + 1}`, rect, doors: [{ side: 'n', at: x0 + 5 }] };
}

export function roomsFor(moduleCount: number): Room[] {
  return [...ROOMS, ...Array.from({ length: moduleCount - 1 }, (_, i) => moduleRoom(i + 1))];
}

/** Hành lang: vòng quanh phòng họp, lối vào giữa hai phòng hàng nam, và hành lang hàng module khi có. */
export function corridorsFor(moduleCount: number): Rect[] {
  const out: Rect[] = [
    { x0: -17, x1: 17, z0: N_ROW.z1, z1: M_ROW.z0 },
    { x0: -17, x1: 17, z0: M_ROW.z1, z1: S_ROW.z0 },
    { x0: -7, x1: -5, ...M_ROW },
    { x0: 5, x1: 7, ...M_ROW },
    { x0: -1, x1: 1, ...S_ROW },
  ];
  if (moduleCount > 1) {
    const mods = Array.from({ length: moduleCount - 1 }, (_, i) => moduleRoom(i + 1).rect);
    out.push({ x0: -1, x1: 1, z0: S_ROW.z1, z1: MODULE_ROW.z0 });
    out.push({ x0: Math.min(-1, ...mods.map((r) => r.x0)), x1: Math.max(1, ...mods.map((r) => r.x1)), z0: S_ROW.z1, z1: MODULE_ROW.z0 });
  }
  return out;
}

/** Đoạn vách thẳng trục. */
export interface Segment {
  side: Side;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Bốn cạnh phòng thành các đoạn vách, đã chừa khe cửa. */
export function wallSegments(room: Room): Segment[] {
  const { x0, z0, x1, z1 } = room.rect;
  const edges: Record<Side, [number, number, number]> = {
    n: [x0, x1, z0],
    s: [x0, x1, z1],
    w: [z0, z1, x0],
    e: [z0, z1, x1],
  };
  const out: Segment[] = [];
  for (const side of ['n', 's', 'e', 'w'] as const) {
    const [a, b, fixed] = edges[side];
    const gaps = room.doors.filter((d) => d.side === side).map((d) => [d.at - DOOR_WIDTH / 2, d.at + DOOR_WIDTH / 2] as const);
    gaps.sort((p, q) => p[0] - q[0]);
    let from = a;
    const push = (p: number, q: number) => {
      if (q - p < 1e-6) return;
      out.push(side === 'n' || side === 's' ? { side, x0: p, x1: q, z0: fixed, z1: fixed } : { side, x0: fixed, x1: fixed, z0: p, z1: q });
    };
    for (const [g0, g1] of gaps) {
      push(from, g0);
      from = g1;
    }
    push(from, b);
  }
  return out;
}

export function rectCenter(r: Rect): Point {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

export function roomById(id: RoomId, moduleCount = 1): Room {
  return roomsFor(Math.max(moduleCount, id.startsWith('general:') ? Number(id.split(':')[1]) + 1 : 1)).find((r) => r.id === id)!;
}

// ---------------- Chỗ ngồi ----------------

export type SeatKind = 'desk' | 'meeting' | 'director' | 'coordinator' | 'rest' | 'stand';

export interface Seat {
  id: string;
  room: RoomId;
  /** Khu domain mà chỗ này phục vụ (Lounge và module thuộc General Workspace). */
  zone: ZoneId;
  kind: SeatKind;
  /** `rest` = chỗ cho Agent rảnh (sofa, bàn đứng); `work` = chỗ làm việc. */
  pool: 'work' | 'rest';
  posture: 'sit' | 'stand';
  x: number;
  z: number;
  /** Hướng mặt (radian quanh trục Y; 0 = nhìn về +Z, về phía camera). */
  facing: number;
  /** Điểm đứng trên lối đi trước khi ngồi vào / sau khi đứng dậy (luôn nằm ngoài vật cản). */
  approach: Point;
  /** Độ cao mặt ngồi (m): ghế làm việc/sofa ≈ 0,46; ghế bar cao hơn. */
  seatHeight?: number;
  /** Thứ tự ưu tiên khi lấy chỗ trống (nhỏ hơn lấy trước). */
  order: number;
}

// ---------------- Đồ đạc ----------------

/** Biến thể bàn làm việc: mỗi phòng một loại máy tính, ghế, bàn. */
export type WorkstationStyle = 'research' | 'script' | 'creative' | 'general' | 'coordinator' | 'director' | 'video';

export type KenneyModel = 'pottedPlant';

export type Item =
  | { kind: 'workstation'; style: WorkstationStyle; x: number; z: number; rot: number }
  | {
      kind:
        | 'meeting_table'
        | 'meeting_chair'
        | 'whiteboard'
        | 'green_cyc'
        | 'camera_rig'
        | 'softbox'
        | 'product_shelf'
        | 'beanbag'
        | 'wall_tv'
        | 'meeting_platform'
        | 'hologram'
        | 'sofa_arc'
        | 'round_coffee'
        | 'bar_round'
        | 'bar_tower'
        | 'bar_stool'
        | 'booth_bench'
        | 'booth_table'
        | 'coffee_table'
        | 'tv_wall'
        | 'cyc_truss'
        | 'product_set'
        | 'led_panel'
        | 'reflector'
        | 'field_monitor'
        // Phòng riêng Research (học giả)
        | 'library_wall'
        | 'statue'
        | 'display_case'
        | 'lamp_post'
        | 'magazine_rack'
        | 'floor_lamp'
        | 'armchair'
        // Phòng riêng Scriptwriting (hồng sang trọng)
        | 'heart_neon'
        | 'flower_vase'
        | 'curtains'
        // Phòng riêng Creative (hiphop)
        | 'graffiti_wall'
        | 'dj_stage'
        | 'speaker'
        | 'led_column'
        | 'neon_crown';
      x: number;
      z: number;
      rot: number;
      color?: string;
    }
  | { kind: 'sofa'; x: number; z: number; rot: number; color: string }
  | { kind: 'rug'; x: number; z: number; rot: number; w: number; d: number; round?: boolean; color: string }
  | { kind: 'kenney'; model: KenneyModel; x: number; z: number; rot: number; y?: number; scale?: number };

/** Vùng cấm đi (chưa nới theo bán kính nhân vật), toạ độ thế giới. */
export interface Obstacle {
  x: number;
  z: number;
  /** Nửa kích thước theo trục x / z (hình chữ nhật thẳng trục) hoặc bán kính (`round`). */
  hx: number;
  hz: number;
  round?: boolean;
}

export interface Plan {
  rooms: Room[];
  corridors: Rect[];
  items: Item[];
  obstacles: Obstacle[];
  seats: Seat[];
}

/** Cánh bàn chữ U (cục bộ theo chỗ ngồi): tâm ±x, z và nửa kích thước. Chỉ bàn Giám đốc và bàn trưởng phòng có cánh. */
export interface UWing {
  x: number;
  z: number;
  hw: number;
  hd: number;
}
export const U_WINGS: Partial<Record<WorkstationStyle, UWing>> = {
  director: { x: 1.2, z: -0.3, hw: 0.3, hd: 0.75 },
  coordinator: { x: 1.1, z: -0.3, hw: 0.3, hd: 0.75 },
};

/** Chiều sâu từ chỗ ngồi tới tâm bàn, và kích thước bàn từng kiểu (rộng × sâu). Bàn phòng riêng to, sang hơn bàn chung. */
export const DESK_AHEAD = 0.85;
export const DESK_SIZE: Record<WorkstationStyle, { w: number; d: number }> = {
  research: { w: 2.4, d: 1.0 },
  script: { w: 2.0, d: 0.9 },
  creative: { w: 2.2, d: 0.95 },
  general: { w: 1.6, d: 0.8 },
  coordinator: { w: 2.8, d: 1.0 },
  director: { w: 3.0, d: 1.0 },
  video: { w: 1.6, d: 0.8 },
};

const HALF_PI = Math.PI / 2;

/** Quầy bar tròn giữa Lounge; người pha chế cố định đứng trong quầy. */
export const BAR_CENTER: Point = { x: 9, z: 11.6 };
export const BAR_RADIUS = 3.0;
/** Bán kính chân tháp kệ rượu giữa quầy, và khoảng từ mép ngoài quầy tới mép mặt quầy phía trong (pha chế). */
export const BAR_TOWER_RADIUS = 0.75;
export const BAR_COUNTER_DEPTH = 0.92;

/** Đổi vector cục bộ (lx, lz) theo hướng `rot` sang thế giới. */
function local(x: number, z: number, rot: number, lx: number, lz: number): Point {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/** Hình chữ nhật cục bộ (tâm lx, lz; nửa kích thước hw, hd) xoay theo bội số π/2. */
function box(x: number, z: number, rot: number, lx: number, lz: number, hw: number, hd: number): Obstacle {
  const p = local(x, z, rot, lx, lz);
  const quarter = Math.round(rot / HALF_PI) % 2 !== 0;
  return { x: p.x, z: p.z, hx: quarter ? hd : hw, hz: quarter ? hw : hd };
}

class PlanBuilder {
  items: Item[] = [];
  obstacles: Obstacle[] = [];
  seats: Seat[] = [];

  seat(s: Omit<Seat, 'order' | 'approach' | 'pool'> & { approach?: Point; pool?: Seat['pool'] }) {
    this.seats.push({ pool: 'work', approach: { x: s.x, z: s.z }, ...s, order: this.seats.length });
  }

  /** Bàn + máy tính + ghế cho một người, người ngồi ở (x, z) nhìn theo `rot`. */
  workstation(room: RoomId, zone: ZoneId, style: WorkstationStyle, x: number, z: number, rot = 0, kind: SeatKind = 'desk') {
    this.items.push({ kind: 'workstation', style, x, z, rot });
    const { w, d } = DESK_SIZE[style];
    this.obstacles.push(box(x, z, rot, 0, DESK_AHEAD, w / 2, d / 2));
    // Thùng máy dưới đất cạnh bàn dựng video.
    if (style === 'video') this.obstacles.push(box(x, z, rot, w / 2 + 0.2, DESK_AHEAD, 0.15, 0.3));
    // Bàn chữ U (Giám đốc, trưởng phòng): hai cánh chạy về phía sau lưng, chừa lối vào giữa.
    const wing = U_WINGS[style];
    if (wing) for (const s of [-1, 1]) this.obstacles.push(box(x, z, rot, s * wing.x, wing.z, wing.hw, wing.hd));
    this.seat({ id: `${room}:${kind}:${this.seats.length}`, room, zone, kind, posture: 'sit', x, z, facing: rot });
  }

  item(it: Item, obstacle?: Obstacle) {
    this.items.push(it);
    if (obstacle) this.obstacles.push(obstacle);
  }

  /** Cây lớn trong chậu (cây nhỏ để bàn đã bỏ theo yêu cầu). */
  plant(x: number, z: number) {
    this.item({ kind: 'kenney', model: 'pottedPlant', x, z, rot: 0 }, { x, z, hx: 0.3, hz: 0.3 });
  }

  /** Chỗ ngồi/đứng nghỉ ở Lounge (khu General Workspace). */
  rest(id: string, x: number, z: number, facing: number, approach: Point, posture: Seat['posture'] = 'sit', seatHeight?: number) {
    this.seat({ id: `lounge:rest:${id}`, room: 'lounge', zone: 'general_workspace', kind: 'rest', pool: 'rest', posture, x, z, facing, approach, seatHeight });
  }
}

// Mỗi phòng chuyên môn là phòng riêng của đúng một người (D-18 sửa 2026-11-23): một bàn lớn giữa phòng quay ra cửa,
// đồ trang trí theo cá tính người ngồi. Đồ treo tường quay vào trong phòng; lối từ cửa tới ghế luôn trống.

/** Đồ trang trí đặt sát tường hoặc dưới sàn, có (hoặc không) vùng cấm đi hình chữ nhật. */
function decor(b: PlanBuilder, kind: Extract<Item, { color?: string }>['kind'], x: number, z: number, rot: number, half?: [number, number], color?: string) {
  b.item({ kind, x, z, rot, ...(color ? { color } : {}) } as Item, half ? box(x, z, rot, 0, 0, half[0], half[1]) : undefined);
}

function research(b: PlanBuilder) {
  // Phòng học giả (An), đối xứng qua trục x = -11 (trục cửa): tủ sách lớn giữa hai cửa sổ tường bắc, hai tượng đồng trên bệ
  // ở hai góc trên (bệ rộng từ mép cửa sổ tới góc), bàn óc chó trên thảm xanh rêu giữa phòng kèm hai kệ tạp chí hai bên,
  // hai tủ kính trưng bày ở hai góc dưới, hai cột đèn đồng hai bên lối vào.
  const ax = -11;
  b.item({ kind: 'rug', x: ax, z: -12.1, rot: 0, w: 4.6, d: 3.4, color: '#2f4a3a' });
  b.workstation('research', 'research', 'research', ax, -12.9);
  decor(b, 'library_wall', ax, -15.25, 0, [2.5, 0.22]);
  for (const s of [-1, 1]) {
    decor(b, 'statue', ax + s * 5.2, -14.95, 0, [0.75, 0.45]);
    decor(b, 'magazine_rack', ax + s * 2.0, -12.1, 0, [0.25, 0.3]);
    decor(b, 'display_case', ax + s * 5.1, -7.15, Math.PI, [0.65, 0.32]);
    decor(b, 'lamp_post', ax + s * 1.7, -7.0, 0, [0.18, 0.18]);
  }
}

function scriptwriting(b: PlanBuilder) {
  // Phòng hồng sang trọng (Hà), đối xứng qua trục x = 11 (trục cửa): tim neon giữa tường bắc (dưới bảng tên), bàn đá trắng
  // chân hộp viền vàng + ghế da hồng trên thảm tròn hồng, hai đèn cây hai bên bàn, hai bình hoa lớn hai góc trên, sofa hồng
  // trên trục giữa quay về bàn (chừa lối hai bên tới cửa), rèm hồng hai cửa sổ.
  const ax = 11;
  b.item({ kind: 'rug', x: ax, z: -12.0, rot: 0, w: 4.4, d: 4.4, round: true, color: '#f6c6d6' });
  b.workstation('scriptwriting', 'scriptwriting', 'script', ax, -12.9);
  decor(b, 'heart_neon', ax, -15.45, 0);
  // Rèm voan hồng cho hai cửa sổ tường bắc (x = 7,4 và 14,6, đối xứng qua trục).
  for (const s of [-1, 1]) decor(b, 'curtains', ax + s * 3.6, -15.45, 0);
  for (const s of [-1, 1]) {
    decor(b, 'floor_lamp', ax + s * 2.3, -12.4, 0, [0.2, 0.2], '#f7b6c8');
    decor(b, 'flower_vase', ax + s * 5.4, -15, 0, [0.25, 0.25]);
  }
  b.item({ kind: 'sofa', x: ax, z: -8.7, rot: Math.PI, color: '#f19cbb' }, box(ax, -8.7, Math.PI, 0, 0, 1.1, 0.45));
}

function director(b: PlanBuilder) {
  // Bàn chữ U quay ra cửa, sau lưng là TV lớn trên tủ kệ thấp; bộ sofa ở giữa phòng (hai sofa quay vào nhau, bàn trà ở giữa)
  // chừa lối hai bên từ cửa vào tới bàn.
  b.workstation('director', 'general_workspace', 'director', 0, -12.6, 0, 'director');
  b.item({ kind: 'tv_wall', x: 0, z: -15.5, rot: 0 }, { x: 0, z: -15.25, hx: 1.5, hz: 0.25 });
  b.item({ kind: 'rug', x: 0, z: -9.1, rot: 0, w: 4.2, d: 3.0, color: '#d9cbb6' });
  for (const s of [-1, 1]) {
    b.plant(s * 4.4, -15);
    b.item({ kind: 'sofa', x: s * 1.75, z: -9.1, rot: -s * HALF_PI, color: '#8a5a3c' }, box(s * 1.75, -9.1, -s * HALF_PI, 0, 0, 1.1, 0.45));
  }
  b.item({ kind: 'coffee_table', x: 0, z: -9.1, rot: HALF_PI }, box(0, -9.1, HALF_PI, 0, 0, 0.6, 0.35));
}

function creative(b: PlanBuilder) {
  // Phòng hiphop (Bình), đối xứng qua trục z = 0 (trục cửa đông): bục DJ giữa tường tây, loa hai bên, graffiti thu hẹp làm
  // phông sau bục kèm vương miện neon; bàn làm việc dịch về phía cửa trên thảm xanh neon; hai ghế lười và hai cột đèn LED ở
  // hai góc cạnh cửa.
  b.item({ kind: 'rug', x: -11.0, z: 0, rot: 0, w: 3.4, d: 3.4, round: true, color: '#00b7ff' });
  b.workstation('creative', 'creative', 'creative', -11.4, 0, HALF_PI);
  decor(b, 'graffiti_wall', -16.95, 0, HALF_PI);
  decor(b, 'neon_crown', -16.9, 0, HALF_PI);
  decor(b, 'dj_stage', -16.15, 0, HALF_PI, [1.2, 0.75]);
  for (const s of [-1, 1]) {
    decor(b, 'speaker', -16.35, s * 1.95, HALF_PI, [0.28, 0.25]);
    b.item({ kind: 'beanbag', x: -8.4, z: s * 3.4, rot: 0, color: '#b14cff' }, { x: -8.4, z: s * 3.4, hx: 0.4, hz: 0.4, round: true });
    decor(b, 'led_column', -7.45, s * 4.05, 0, [0.16, 0.16]);
  }
}

function meeting(b: PlanBuilder) {
  // Phòng họp kiểu phi thuyền: bệ tròn tối viền sáng, bàn tròn trắng bóng có vòng đèn, máy chiếu hologram, ghế vỏ trứng.
  b.item({ kind: 'meeting_platform', x: 0, z: 0, rot: 0 });
  b.item({ kind: 'meeting_table', x: 0, z: 0, rot: 0 }, { x: 0, z: 0, hx: 1.6, hz: 1.6, round: true });
  b.item({ kind: 'hologram', x: 0, z: 0, rot: 0 });
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = Math.sin(a) * 2.45;
    const z = Math.cos(a) * 2.45;
    b.item({ kind: 'meeting_chair', x, z, rot: a + Math.PI });
    b.seat({
      id: `meeting_room:meeting:${i}`,
      room: 'meeting_room',
      zone: 'meeting_room',
      kind: 'meeting',
      posture: 'sit',
      x,
      z,
      facing: a + Math.PI,
      approach: { x: Math.sin(a) * 3.15, z: Math.cos(a) * 3.15 },
    });
  }
}

function general(b: PlanBuilder) {
  // Mọi bàn quay mặt ra cửa tây (nhìn -x), đối xứng qua trục z = 0. Bàn chữ U của trưởng phòng (coordinator) ở cuối phòng
  // đối diện cửa, hai bàn general ở hàng trước; khe giữa hai bàn để đi tới bàn trưởng phòng.
  b.workstation('general_workspace', 'general_workspace', 'coordinator', 14.8, 0, -HALF_PI, 'coordinator');
  // Hai bàn cho Publisher và Analyst (D-18 sửa 2026-11-23).
  for (const z of [-1.8, 1.8]) b.workstation('general_workspace', 'general_workspace', 'general', 11.2, z, -HALF_PI);
  for (const z of [-3.9, 3.9]) b.plant(16.4, z);
}

function videoStudio(b: PlanBuilder) {
  // Phòng quay sản phẩm: phông xanh trên tường tây, bục sản phẩm, máy quay, hai đèn softbox chiếu chéo.
  b.item({ kind: 'green_cyc', x: -17, z: 11, rot: 0 }, { x: -16.9, z: 11, hx: 0.1, hz: 3.5 });
  // Trang trí khu phông xanh: giàn khung đèn, cụm bục sản phẩm nhiều tầng, đèn LED bảng, tấm hắt sáng, vạch đánh dấu sàn.
  b.item({ kind: 'cyc_truss', x: -17, z: 11, rot: 0 }, { x: -16.55, z: 11, hx: 0.15, hz: 3.75 });
  b.item({ kind: 'product_set', x: -15.2, z: 11, rot: HALF_PI }, { x: -15.2, z: 11, hx: 0.6, hz: 1.0 });
  for (const s of [-1, 1]) b.item({ kind: 'led_panel', x: -14.1, z: 11 + s * 2.9, rot: -HALF_PI - s * 0.9 }, { x: -14.1, z: 11 + s * 2.9, hx: 0.3, hz: 0.3 });
  b.item({ kind: 'reflector', x: -14.4, z: 12.7, rot: -HALF_PI - 0.5 }, { x: -14.4, z: 12.7, hx: 0.3, hz: 0.3 });
  b.item({ kind: 'field_monitor', x: -10.6, z: 12.0, rot: -HALF_PI }, { x: -10.6, z: 12.0, hx: 0.25, hz: 0.25 });
  b.item({ kind: 'camera_rig', x: -11.4, z: 11, rot: -HALF_PI }, { x: -11.4, z: 11, hx: 0.35, hz: 0.35 });
  // Chỗ làm việc của Video Producer: đứng sau máy quay.
  b.seat({ id: 'video_studio:stand:camera', room: 'video_studio', zone: 'video_studio', kind: 'stand', posture: 'stand', x: -10.5, z: 11, facing: -HALF_PI });
  for (const s of [-1, 1]) {
    const z = 11 + s * 2.6;
    b.item({ kind: 'softbox', x: -12.9, z, rot: -HALF_PI - s * 0.6 }, { x: -12.9, z, hx: 0.35, hz: 0.35 });
  }
  // Cả tường phải (đông) là dãy kệ sản phẩm, căn giữa chiều sâu phòng.
  for (const z of [8.6, 11, 13.4]) b.item({ kind: 'product_shelf', x: -1.35, z, rot: -HALF_PI }, { x: -1.35, z, hx: 0.3, hz: 1.2 });
  // Sofa vòng cung lớn trải gần hết chiều ngang phòng, quay về khu quay (tây); hai đầu và sau lưng chừa lối đi.
  const c = { x: -7.2, z: 11 };
  const R = 3.5;
  b.item({ kind: 'rug', x: c.x + 1.2, z: c.z, rot: 0, w: 5.6, d: 5.6, round: true, color: '#33363b' });
  for (let k = -6; k <= 6; k++) {
    const a = HALF_PI + k * 0.21;
    const x = c.x + Math.sin(a) * R;
    const z = c.z + Math.cos(a) * R;
    b.item({ kind: 'sofa_arc', x, z, rot: a + Math.PI }, { x, z, hx: 0.42, hz: 0.42, round: true });
  }
  // Bàn nước tròn lớn trước giữa sofa, cách lòng sofa ≈ 1 m để đi lại.
  const t = { x: c.x + 1.2, z: c.z };
  b.item({ kind: 'round_coffee', x: t.x, z: t.z, rot: 0 }, { x: t.x, z: t.z, hx: 0.9, hz: 0.9, round: true });
  for (const j of [-2, 0, 2]) {
    const a = HALF_PI + j * 0.32;
    b.seat({
      id: `video_studio:sofa:${j}`,
      room: 'video_studio',
      zone: 'video_studio',
      kind: 'desk',
      posture: 'sit',
      x: c.x + Math.sin(a) * (R - 0.1),
      z: c.z + Math.cos(a) * (R - 0.1),
      facing: a + Math.PI,
      approach: { x: c.x + Math.sin(a) * (R - 0.95), z: c.z + Math.cos(a) * (R - 0.95) },
    });
  }
}

function lounge(b: PlanBuilder) {
  // Quán pub kê đối xứng qua trục giữa phòng: quầy bar tròn ở giữa (cửa lò xo hai cánh ở giữa phía nam, tháp kệ rượu và
  // mái đèn neon ở giữa), ghế bar quanh quầy; hai dãy booth ghế da sát hai vách; cây lớn ở hai góc.
  const c = BAR_CENTER;
  b.item({ kind: 'bar_round', x: c.x, z: c.z, rot: 0 }, { x: c.x, z: c.z, hx: BAR_RADIUS, hz: BAR_RADIUS, round: true });
  b.item({ kind: 'bar_tower', x: c.x, z: c.z, rot: 0 });
  // Cửa quầy lò xo ở giữa phía nam (góc 0, k = 12): bỏ ghế ở đó và cặp ghế hai bên cửa (k = 11, 13) để trước cửa quầy
  // thoáng (quầy to, sát mép nam toà nhà); vòng ghế đối xứng qua trục x = 9.
  for (let k = 0; k < 16; k++) {
    if (k >= 11 && k <= 13) continue;
    const a = HALF_PI + (k * Math.PI) / 8;
    const r = BAR_RADIUS + 0.45;
    const x = c.x + Math.sin(a) * r;
    const z = c.z + Math.cos(a) * r;
    b.item({ kind: 'bar_stool', x, z, rot: a + Math.PI }, { x, z, hx: 0.2, hz: 0.2, round: true });
    b.rest(`stool:${k}`, x, z, a + Math.PI, { x: c.x + Math.sin(a) * (r + 0.7), z: c.z + Math.cos(a) * (r + 0.7) }, 'sit', 0.78);
  }
  for (const bx of [2.4, 15.6]) {
    const out = bx < c.x ? 1 : -1;
    for (const cz of [9.3, 12.9]) {
      b.item({ kind: 'booth_table', x: bx, z: cz, rot: 0 }, { x: bx, z: cz, hx: 0.75, hz: 0.42 });
      for (const s of [-1, 1]) {
        const z = cz + s * 0.98;
        const facing = s < 0 ? 0 : Math.PI;
        b.item({ kind: 'booth_bench', x: bx, z, rot: facing }, { x: bx, z: z + s * 0.12, hx: 0.95, hz: 0.18 });
        for (const dx of [-0.45, 0.45]) b.rest(`booth:${bx}:${cz}:${s}:${dx}`, bx + dx, z - s * 0.05, facing, { x: bx + out * 1.45, z: z - s * 0.05 });
      }
    }
  }
  b.plant(1.6, 7.1);
  b.plant(16.4, 7.1);
}

function modules(b: PlanBuilder, moduleCount: number) {
  for (let k = 1; k < moduleCount; k++) {
    const r = moduleRoom(k).rect;
    for (const z of [19.6, 22.8]) for (const dx of [3, 7]) b.workstation(`general:${k}`, 'general_workspace', 'general', r.x0 + dx, z);
  }
}

const planCache = new Map<number, Plan>();

/** Mặt bằng đầy đủ khi General Workspace có `moduleCount` module (1 = chỉ tòa nhà chính). */
export function planFor(moduleCount: number): Plan {
  const cached = planCache.get(moduleCount);
  if (cached) return cached;
  const b = new PlanBuilder();
  research(b);
  director(b);
  scriptwriting(b);
  creative(b);
  meeting(b);
  general(b);
  videoStudio(b);
  lounge(b);
  modules(b, moduleCount);
  const plan: Plan = { rooms: roomsFor(moduleCount), corridors: corridorsFor(moduleCount), items: b.items, obstacles: b.obstacles, seats: b.seats };
  planCache.set(moduleCount, plan);
  return plan;
}

/** Chỗ ngồi của module k (để mở thêm khi General Workspace đầy). */
export function moduleSeats(k: number): Seat[] {
  return planFor(k + 1).seats.filter((s) => s.room === `general:${k}`);
}

/** Phạm vi mọi thứ đã dựng (để canh camera). */
export function extentFor(moduleCount: number): Rect {
  const rs = roomsFor(moduleCount).map((r) => r.rect);
  return {
    x0: Math.min(...rs.map((r) => r.x0)),
    x1: Math.max(...rs.map((r) => r.x1)),
    z0: Math.min(...rs.map((r) => r.z0)),
    z1: Math.max(...rs.map((r) => r.z1)),
  };
}
