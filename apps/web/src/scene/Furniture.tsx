// Nội thất theo mặt bằng (office/plan.ts). Đồ đặc trưng từng phòng (bàn, máy tính, ghế, phòng quay…) dựng bằng khối cơ bản,
// gộp thành InstancedMesh theo (hình, vật liệu) và nhuộm từng bản; cây, sofa, kệ sách dùng model Kenney (CC0).
// Toạ độ cục bộ của mỗi món: gốc trên sàn, +Z là hướng nhìn của người ngồi (màn hình quay về -Z, phía người ngồi).

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BAR_RADIUS, DESK_AHEAD, DESK_SIZE, U_WINGS, planFor, type Item, type KenneyModel, type UWing, type WorkstationStyle } from '../office/plan.ts';
import { KitInstances, type Placement } from './KitInstances.tsx';

type Shape = 'box' | 'cyl' | 'sphere' | 'shell' | 'ring' | 'cone';
type Mat = 'matte' | 'gloss' | 'chrome' | 'screen' | 'holo';

/** Một khối: tâm (x, y, z), kích thước (sx, sy, sz), góc xoay Euler XYZ. */
export interface Part {
  shape: Shape;
  mat: Mat;
  color: string;
  p: [number, number, number];
  s: [number, number, number];
  r?: [number, number, number];
}

const P = (shape: Shape, color: string, p: Part['p'], s: Part['s'], r?: Part['r'], mat: Mat = 'matte'): Part => ({ shape, mat, color, p, s, r });
const box = (color: string, p: Part['p'], s: Part['s'], r?: Part['r'], mat?: Mat) => P('box', color, p, s, r, mat);
const cyl = (color: string, p: Part['p'], s: Part['s'], r?: Part['r'], mat?: Mat) => P('cyl', color, p, s, r, mat);

const C = {
  black: '#1d1f23',
  charcoal: '#2d3035',
  grey: '#6b7380',
  silver: '#c3c7cc',
  white: '#f4f3ef',
  walnut: '#4a3528',
  walnutLight: '#6a4a35',
  oak: '#c79f73',
  leather: '#7a4a2e',
  screen: '#9fd4ff',
  screenWarm: '#ffe2b0',
  yellow: '#f5c242',
  green: '#3fbf5a',
  cyan: '#5ce1ff',
  chrome: '#d9dde2',
  oakLight: '#dcb98f',
};

const TOP = 0.88;

// ---------------- Bàn, máy tính, ghế ----------------

/** Bàn xịn chân hộp liền khối: hai hộc đặc hai đầu nối tấm ốp trước, mặt đá dày, viền kim loại quanh mép và chân. */
function luxeDesk(w: number, d: number, top: string, body: string, trim: string): Part[] {
  const z = DESK_AHEAD;
  const out = [
    box(top, [0, TOP - 0.03, z], [w, 0.06, d], undefined, 'gloss'),
    ...[-1, 1].map((sz) => box(trim, [0, TOP - 0.03, z + sz * (d / 2 + 0.006)], [w + 0.024, 0.065, 0.012], undefined, 'chrome')),
    ...[-1, 1].map((sx) => box(trim, [sx * (w / 2 + 0.006), TOP - 0.03, z], [0.012, 0.065, d], undefined, 'chrome')),
    box(body, [0, 0.47, z + d / 2 - 0.08], [w - 0.1, 0.78, 0.05], undefined, 'gloss'),
  ];
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.24);
    out.push(box(body, [x, (TOP - 0.06) / 2, z], [0.44, TOP - 0.06, d - 0.06], undefined, 'gloss'));
    out.push(box(trim, [x, 0.015, z], [0.46, 0.03, d - 0.04], undefined, 'chrome'));
    for (const y of [0.24, 0.52]) out.push(box(trim, [x, y, z - d / 2 + 0.025], [0.16, 0.015, 0.015], undefined, 'chrome'));
  }
  return out;
}

function desk(w: number, d: number, top: string, leg: string, style: 'sled' | 'post' | 'exec'): Part[] {
  const z = DESK_AHEAD;
  const edge = new THREE.Color(top).multiplyScalar(0.72).getStyle();
  const out = [
    box(top, [0, TOP - 0.025, z], [w, 0.05, d], undefined, 'gloss'),
    // Nẹp cạnh trước và sau.
    box(edge, [0, TOP - 0.025, z - d / 2 + 0.005], [w + 0.004, 0.052, 0.012]),
    box(edge, [0, TOP - 0.025, z + d / 2 - 0.005], [w + 0.004, 0.052, 0.012]),
  ];
  if (style === 'post') {
    // Chân gỗ tròn hơi xiên ra ngoài.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) out.push(cyl(leg, [sx * (w / 2 - 0.1), (TOP - 0.05) / 2, z + sz * (d / 2 - 0.1)], [0.045, TOP - 0.04, 0.045], [sz * 0.06, 0, -sx * 0.06]));
  } else if (style === 'sled') {
    // Khung kim loại chữ U mỗi bên + thanh giằng sau + máng dây.
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.08);
      out.push(box(leg, [x, TOP / 2, z - d / 2 + 0.08], [0.04, TOP - 0.05, 0.04], undefined, 'chrome'));
      out.push(box(leg, [x, TOP / 2, z + d / 2 - 0.08], [0.04, TOP - 0.05, 0.04], undefined, 'chrome'));
      out.push(box(leg, [x, 0.02, z], [0.05, 0.03, d - 0.1], undefined, 'chrome'));
      out.push(box(leg, [x, TOP - 0.07, z], [0.04, 0.03, d - 0.12], undefined, 'chrome'));
    }
    out.push(box(leg, [0, TOP - 0.18, z + d / 2 - 0.1], [w - 0.2, 0.08, 0.06], undefined, 'chrome'));
  } else {
    // Bàn Giám đốc: hai hộc tủ, tấm ốp trước có đường viền, mặt da.
    for (const sx of [-1, 1]) {
      out.push(box(leg, [sx * (w / 2 - 0.25), (TOP - 0.05) / 2, z], [0.48, TOP - 0.05, d - 0.06]));
      for (const y of [0.22, 0.48]) out.push(box(edge, [sx * (w / 2 - 0.25), y, z - d / 2 + 0.02], [0.4, 0.2, 0.01]));
      for (const y of [0.22, 0.48]) out.push(box(C.chrome, [sx * (w / 2 - 0.25), y + 0.06, z - d / 2 + 0.01], [0.12, 0.015, 0.015], undefined, 'chrome'));
    }
    out.push(box(leg, [0, 0.5, z + d / 2 - 0.06], [w - 0.1, 0.66, 0.04]));
    out.push(box(edge, [0, 0.5, z + d / 2 - 0.035], [w - 0.3, 0.5, 0.01]));
    out.push(box('#2f3a33', [0, TOP + 0.003, z - 0.05], [w - 0.5, 0.006, d - 0.35]));
  }
  return out;
}

/** Màn hình viền mỏng trên tay đỡ, mặt kính quay về người ngồi. */
function monitor(x: number, w: number, h: number, ry = 0, z = DESK_AHEAD + 0.22, frame = C.black, screen = C.screen): Part[] {
  const y = TOP + 0.18 + h / 2;
  const sx = Math.sin(ry) * -0.012;
  const sz = Math.cos(ry) * -0.012;
  return [
    cyl(frame, [x, TOP + 0.008, z + 0.06], [0.22, 0.016, 0.16], undefined, 'gloss'),
    box(frame, [x, TOP + 0.12, z + 0.07], [0.04, 0.22, 0.03], undefined, 'gloss'),
    box(frame, [x, y, z + 0.01], [w * 0.35, h * 0.4, 0.04], [0, ry, 0], 'gloss'),
    box(frame, [x, y, z], [w, h, 0.018], [0, ry, 0], 'gloss'),
    box(screen, [x + sx, y + 0.005, z + sz], [w - 0.02, h - 0.03, 0.004], [0, ry, 0], 'screen'),
  ];
}

/** Bàn phím, chuột, thảm da kê bàn, cốc cà phê. */
function deskKit(color = C.charcoal, mat = '#2b2e33', mug = '#f2efe9'): Part[] {
  return [
    box(mat, [0.08, TOP + 0.003, DESK_AHEAD - 0.17], [0.9, 0.006, 0.34]),
    box(color, [0, TOP + 0.014, DESK_AHEAD - 0.18], [0.44, 0.018, 0.14], undefined, 'gloss'),
    box(color, [0.36, TOP + 0.016, DESK_AHEAD - 0.17], [0.06, 0.022, 0.1], undefined, 'gloss'),
    cyl(mug, [-0.5, TOP + 0.05, DESK_AHEAD - 0.15], [0.08, 0.1, 0.08], undefined, 'gloss'),
    cyl('#3b2516', [-0.5, TOP + 0.098, DESK_AHEAD - 0.15], [0.065, 0.004, 0.065]),
  ];
}

function laptop(x = 0): Part[] {
  const z = DESK_AHEAD - 0.05;
  return [
    box(C.silver, [x, TOP + 0.01, z], [0.36, 0.02, 0.25], undefined, 'chrome'),
    box(C.silver, [x, TOP + 0.13, z + 0.17], [0.36, 0.24, 0.015], [-0.25, 0, 0], 'chrome'),
    box(C.screen, [x, TOP + 0.13, z + 0.16], [0.33, 0.21, 0.005], [-0.25, 0, 0], 'screen'),
  ];
}

/** Ghế: người ngồi ở gốc, lưng ghế phía -Z. */
function chair(kind: 'office' | 'ergo' | 'leather' | 'exec' | 'color', color?: string): Part[] {
  const seatY = 0.46;
  if (kind === 'color') {
    // Ghế thiết kế: lòng ghế liền khối bo, chân gỗ xiên có thanh giằng kim loại.
    const c = color ?? C.yellow;
    return [
      box(c, [0, seatY, -0.04], [0.48, 0.05, 0.46], undefined, 'gloss'),
      box(c, [0, seatY + 0.04, 0.19], [0.48, 0.05, 0.05], [0.5, 0, 0], 'gloss'),
      box(c, [0, seatY + 0.26, -0.26], [0.48, 0.38, 0.05], [-0.15, 0, 0], 'gloss'),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(C.oak, [sx * 0.18, seatY / 2, -0.04 + sz * 0.16], [0.035, seatY, 0.035], [sz * 0.15, 0, -sx * 0.15]))),
      box(C.charcoal, [0, 0.2, -0.04], [0.36, 0.015, 0.015], undefined, 'chrome'),
    ];
  }
  const base = [...starBase(-0.05), cyl(C.chrome, [0, 0.27, -0.05], [0.06, 0.36, 0.06], undefined, 'chrome')];
  if (kind === 'office' || kind === 'ergo') {
    // Ghế công thái học: đệm, lưng lưới có khung, đỡ thắt lưng, tay vịn; ghế ergo có tựa đầu.
    const fabric = color ?? (kind === 'ergo' ? C.black : C.grey);
    const backH = kind === 'ergo' ? 0.6 : 0.5;
    const by = seatY + 0.1 + backH / 2;
    const out = [
      ...base,
      box(fabric, [0, seatY, -0.05], [0.52, 0.08, 0.5]),
      box(C.charcoal, [0, by, -0.3], [0.5, backH, 0.03], [-0.1, 0, 0], 'gloss'),
      box(fabric, [0, by, -0.285], [0.44, backH - 0.06, 0.02], [-0.1, 0, 0]),
      box(C.charcoal, [0, seatY + 0.2, -0.27], [0.4, 0.08, 0.04], [-0.1, 0, 0]),
      box(C.charcoal, [0, seatY + 0.1, -0.31], [0.06, 0.2, 0.03]),
    ];
    for (const sx of [-1, 1]) {
      out.push(box(C.charcoal, [sx * 0.28, seatY + 0.1, -0.08], [0.03, 0.18, 0.03]));
      out.push(box(C.charcoal, [sx * 0.28, seatY + 0.2, -0.04], [0.06, 0.025, 0.26]));
    }
    if (kind === 'ergo') out.push(box(fabric, [0, by + backH / 2 + 0.1, -0.35], [0.32, 0.14, 0.04], [-0.1, 0, 0]));
    return out;
  }
  // Ghế da: đệm dày, lưng cao có đường chần ngang, tựa đầu, tay vịn bọc da (màu mặc định theo loại, đổi được).
  const leather = color ?? (kind === 'leather' ? C.leather : '#1f1f22');
  const seam = new THREE.Color(leather).multiplyScalar(0.7).getStyle();
  const backH = kind === 'exec' ? 0.82 : 0.74;
  const by = seatY + 0.08 + backH / 2;
  const out = [
    ...base,
    box(leather, [0, seatY, -0.05], [0.54, 0.12, 0.52], undefined, 'gloss'),
    box(leather, [0, by, -0.3], [0.52, backH, 0.12], [-0.1, 0, 0], 'gloss'),
    box(leather, [0, seatY + 0.14 + backH, -0.36], [0.36, 0.16, 0.12], [-0.1, 0, 0], 'gloss'),
  ];
  for (let k = 1; k < 4; k++) out.push(box(seam, [0, seatY + 0.08 + (backH * k) / 4, -0.3 + 0.062 - k * 0.012], [0.46, 0.012, 0.01], [-0.1, 0, 0]));
  for (const sx of [-1, 1]) {
    out.push(box(leather, [sx * 0.3, seatY + 0.18, -0.06], [0.08, 0.08, 0.44], undefined, 'gloss'));
    out.push(box(C.chrome, [sx * 0.3, seatY + 0.08, 0.0], [0.03, 0.14, 0.03], undefined, 'chrome'));
  }
  return out;
}

/** Chân sao 5 cánh mạ chrome có bánh xe. */
function starBase(z: number): Part[] {
  const out: Part[] = [cyl(C.chrome, [0, 0.08, z], [0.1, 0.06, 0.1], undefined, 'chrome')];
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5;
    out.push(box(C.chrome, [Math.sin(a) * 0.15, 0.07, z + Math.cos(a) * 0.15], [0.05, 0.03, 0.3], [0, a, 0], 'chrome'));
    out.push(cyl(C.black, [Math.sin(a) * 0.29, 0.03, z + Math.cos(a) * 0.29], [0.06, 0.05, 0.06]));
  }
  return out;
}

/** Hai cánh bàn chữ U chạy về sau lưng, mặt gỗ trên hộc tủ. */
function uWings(w: UWing): Part[] {
  return [-1, 1].flatMap((sx) => [
    box(C.walnutLight, [sx * w.x, TOP - 0.025, w.z], [w.hw * 2, 0.05, w.hd * 2], undefined, 'gloss'),
    box(C.walnut, [sx * w.x, (TOP - 0.05) / 2, w.z], [w.hw * 2 - 0.06, TOP - 0.05, w.hd * 2 - 0.06]),
    box(C.chrome, [sx * (w.x - w.hw + 0.01), 0.55, w.z], [0.015, 0.015, 0.2], undefined, 'chrome'),
  ]);
}

/** Bàn + đồ trên bàn; `withChair=false` bỏ ghế (để kiểm tra mặt bằng bàn). */
export function workstation(style: WorkstationStyle, withChair = true): Part[] {
  const parts = workstationParts(style);
  return withChair ? parts : parts.filter((p) => !chairParts.has(p));
}

const chairParts = new WeakSet<Part>();
function ch(...a: Parameters<typeof chair>): Part[] {
  const out = chair(...a);
  out.forEach((p) => chairParts.add(p));
  return out;
}

function workstationParts(style: WorkstationStyle): Part[] {
  const { w, d } = DESK_SIZE[style];
  switch (style) {
    case 'research':
      // Học giả: bàn óc chó lớn chân hộp, hai màn hình, đèn bàn "banker" chụp xanh, chồng sách, ghế da cao.
      return [
        ...desk(w, d, C.walnut, C.walnut, 'exec'),
        ...monitor(-0.36, 0.62, 0.38, 0.18),
        ...monitor(0.36, 0.62, 0.38, -0.18),
        cyl('#c9a227', [-0.95, TOP + 0.01, DESK_AHEAD + 0.2], [0.14, 0.02, 0.14], undefined, 'chrome'),
        cyl('#c9a227', [-0.95, TOP + 0.13, DESK_AHEAD + 0.2], [0.02, 0.24, 0.02], undefined, 'chrome'),
        cyl('#1f6b45', [-0.95, TOP + 0.27, DESK_AHEAD + 0.15], [0.12, 0.08, 0.3], [Math.PI / 2, 0, 0], 'gloss'),
        box(C.screenWarm, [-0.95, TOP + 0.23, DESK_AHEAD + 0.15], [0.2, 0.01, 0.06], undefined, 'screen'),
        ...['#8b2e2e', '#2e4a8b', '#c9a227', '#3b6b3b'].map((c, i) => box(c, [0.95, TOP + 0.03 + i * 0.05, DESK_AHEAD + 0.05], [0.28 - i * 0.02, 0.045, 0.2], [0, i * 0.12, 0])),
        ...deskKit(C.charcoal, '#3a2a20'),
        ...ch('exec'),
      ];
    case 'script':
      // Hồng sang trọng: bàn mặt đá trắng chân hộp liền viền vàng, màn hình viền hồng, bình hoa nhỏ, ghế da lớn màu hồng.
      return [
        ...luxeDesk(w, d, '#f7f4f1', '#f3c6d4', '#d4af37'),
        ...monitor(0, 0.7, 0.42, 0, DESK_AHEAD + 0.22, '#f7b6c8'),
        cyl('#f19cbb', [0.75, TOP + 0.08, DESK_AHEAD + 0.15], [0.1, 0.16, 0.1], undefined, 'gloss'),
        ...[-0.05, 0, 0.05].map((dx, i) => P('sphere', ['#ff6fa3', '#fff1a8', '#ff9ec4'][i]!, [0.75 + dx, TOP + 0.22 + i * 0.02, DESK_AHEAD + 0.15 + dx], [0.08, 0.08, 0.08])),
        box('#ffd1e1', [-0.75, TOP + 0.02, DESK_AHEAD - 0.05], [0.26, 0.03, 0.2]),
        ...deskKit('#f7b6c8', '#ffe4ee', '#ff6fa3'),
        ...ch('exec', '#f19cbb'),
      ];
    case 'creative':
      // Hiphop: bàn đen bóng viền LED tím, màn hình lớn, tai nghe trên bàn, ghế gaming đen đỏ.
      return [
        ...desk(w, d, '#18181c', C.black, 'sled'),
        box('#b14cff', [0, TOP - 0.06, DESK_AHEAD - d / 2 - 0.004], [w, 0.015, 0.01], undefined, 'screen'),
        box('#b14cff', [0, TOP - 0.06, DESK_AHEAD + d / 2 + 0.004], [w, 0.015, 0.01], undefined, 'screen'),
        ...monitor(0, 0.95, 0.5, 0, DESK_AHEAD + 0.25, C.black),
        P('ring', '#f5c242', [0.75, TOP + 0.08, DESK_AHEAD + 0.05], [0.2, 0.2, 2.5], [0, 0, 0]),
        box(C.black, [0.75, TOP + 0.02, DESK_AHEAD + 0.05], [0.18, 0.04, 0.08]),
        ...deskKit(C.black, '#2b1d3a', '#f5c242'),
        ...ch('ergo', '#c62828'),
      ];
    case 'general':
      return [...desk(w, d, C.white, C.charcoal, 'sled'), ...monitor(0, 0.62, 0.38), ...deskKit(), ...ch('office')];
    case 'coordinator':
      return [
        // Bàn trưởng phòng chữ U lớn: mặt chính + hai cánh chạy về sau lưng, ba màn hình cong vào trong, ghế exec.
        ...desk(w, d, C.walnutLight, C.walnut, 'exec'),
        ...uWings(U_WINGS.coordinator!),
        ...monitor(-0.75, 0.66, 0.4, 0.3, DESK_AHEAD + 0.2),
        ...monitor(0, 0.8, 0.45, 0, DESK_AHEAD + 0.25),
        ...monitor(0.75, 0.66, 0.4, -0.3, DESK_AHEAD + 0.2),
        // Thùng máy dưới mặt bàn, giữa hộc tủ phải và chân ghế, không lòi ra ngoài mặt bàn.
        box(C.black, [0.6, 0.2, DESK_AHEAD + 0.1], [0.18, 0.4, 0.42], undefined, 'gloss'),
        box(C.cyan, [0.6, 0.28, DESK_AHEAD + 0.1 - 0.211], [0.015, 0.25, 0.005], undefined, 'screen'),
        ...laptop(-0.95),
        box(C.white, [1.1, TOP + 0.03, -0.3], [0.22, 0.06, 0.3]),
        box('#f2d16b', [1.1, TOP + 0.07, -0.3], [0.2, 0.02, 0.28], [0, 0.2, 0]),
        ...deskKit(C.charcoal, '#3a2a20'),
        ...ch('exec'),
      ];
    case 'director':
      return [
        ...desk(w, d, C.walnutLight, C.walnut, 'exec'),
        // Hai cánh bàn chữ U chạy về sau lưng, mặt gỗ trên hộc tủ.
        ...uWings(U_WINGS.director!),
        ...monitor(-1.2, 0.62, 0.38, Math.PI / 2, -0.3),
        box('#e8e2d6', [1.2, TOP + 0.03, -0.3], [0.3, 0.05, 0.4]),
        ...laptop(0),
        cyl(C.chrome, [0.9, TOP + 0.02, DESK_AHEAD + 0.25], [0.16, 0.02, 0.16], undefined, 'chrome'),
        cyl(C.chrome, [0.9, TOP + 0.2, DESK_AHEAD + 0.25], [0.025, 0.38, 0.025], undefined, 'chrome'),
        cyl(C.screenWarm, [0.9, TOP + 0.42, DESK_AHEAD + 0.25], [0.24, 0.12, 0.24], undefined, 'screen'),
        box(C.black, [-0.8, TOP + 0.02, DESK_AHEAD], [0.3, 0.04, 0.22], undefined, 'gloss'),
        cyl('#c9a227', [-0.55, TOP + 0.06, DESK_AHEAD - 0.2], [0.03, 0.12, 0.03], [0, 0, 1.2], 'chrome'),
        ...ch('exec'),
      ];
    case 'video':
      return [
        ...desk(w, d, C.charcoal, C.black, 'sled'),
        ...monitor(0, 0.8, 0.45),
        box(C.black, [w / 2 + 0.2, 0.23, DESK_AHEAD], [0.2, 0.45, 0.45]),
        box('#4d96ff', [w / 2 + 0.2, 0.3, DESK_AHEAD - 0.226], [0.02, 0.3, 0.005], undefined, 'screen'),
        ...deskKit(),
        ...ch('office'),
      ];
  }
}

// ---------------- Đồ khác ----------------

/** Đồ trang trí phòng riêng. Đồ sát tường: gốc ở mặt tường, nhô về +Z (vào phòng). Mọi món đối xứng qua trục x = 0 cục bộ. */
function decorParts(it: Extract<Item, { color?: string }>): Part[] {
  switch (it.kind) {
    case 'library_wall': {
      // Tủ sách lớn giữa hai cửa sổ: 5 m × 2,2 m (thấp hơn bảng tên phòng), 4 khoang, 5 tầng; sách xếp đối xứng qua giữa.
      const W = 5;
      const H = 2.2;
      const books = ['#8b2e2e', '#2e4a8b', '#c9a227', '#3b6b3b', '#6b3b6b', '#d8c7a5', '#1d1f23'];
      const out: Part[] = [box(C.walnut, [0, H / 2, -0.18], [W, H, 0.04])];
      for (let i = 0; i <= 4; i++) out.push(box(C.walnut, [-W / 2 + (i * W) / 4, H / 2, 0], [0.06, H, 0.44]));
      for (const y of [0.04, 0.5, 0.95, 1.4, 1.85]) out.push(box(C.walnutLight, [0, y, 0], [W, 0.04, 0.44]));
      out.push(box(C.walnut, [0, H - 0.03, 0.02], [W + 0.1, 0.08, 0.48]));
      // Một nửa (x ≥ 0) rồi soi gương sang nửa kia để hai bên giống hệt nhau.
      const half: Part[] = [];
      [0.04, 0.5, 0.95, 1.4].forEach((y, row) => {
        let x = 0.06;
        for (let k = row * 3; x < W / 2 - 0.1; k++) {
          const bw = 0.05 + ((k * 7) % 4) * 0.012;
          const bh = 0.28 + ((k * 5) % 5) * 0.025;
          if (k % 9 !== 4) half.push(box(books[k % books.length]!, [x + bw / 2, y + 0.02 + bh / 2, 0.02], [bw, bh, 0.3]));
          x += bw + 0.008 + (k % 9 === 4 ? 0.14 : 0);
        }
      });
      out.push(...half, ...half.map((p) => ({ ...p, p: [-p.p[0], p.p[1], p.p[2]] as Part['p'] })));
      return out;
    }
    case 'statue': {
      // Tượng bán thân bằng đồng (nổi trên sàn gỗ tối) trên bệ đá sáng rộng 1,5 m.
      const bronze = '#cd8c4a';
      const shade = '#a96b32';
      return [
        box('#d9d4cc', [0, 0.06, 0], [1.5, 0.12, 0.9], undefined, 'gloss'),
        box('#ece7df', [0, 0.55, 0], [1.3, 0.86, 0.72], undefined, 'gloss'),
        box('#d9d4cc', [0, 1.0, 0], [1.4, 0.06, 0.8], undefined, 'gloss'),
        box('#c9c2b6', [0, 0.55, 0.365], [1.0, 0.5, 0.01]),
        box(shade, [0, 1.13, 0], [0.5, 0.2, 0.4], undefined, 'gloss'),
        P('sphere', bronze, [0, 1.42, 0], [0.62, 0.48, 0.38], undefined, 'gloss'),
        cyl(bronze, [0, 1.72, 0], [0.16, 0.2, 0.16], undefined, 'gloss'),
        P('sphere', bronze, [0, 1.98, 0.01], [0.34, 0.42, 0.36], undefined, 'gloss'),
        P('sphere', shade, [0, 2.12, -0.03], [0.36, 0.22, 0.36], undefined, 'gloss'),
      ];
    }
    case 'display_case': {
      // Tủ kính trưng bày khung óc chó, đèn vàng bên trong: sách cổ, cuộn giấy, bình gốm (bày đối xứng qua giữa).
      const out: Part[] = [
        box(C.walnut, [0, 0.35, 0], [1.3, 0.7, 0.62], undefined, 'gloss'),
        box(C.walnut, [0, 2.0, 0], [1.3, 0.08, 0.62], undefined, 'gloss'),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(C.walnut, [sx * 0.62, 1.35, sz * 0.28], [0.05, 1.3, 0.05]))),
        box('#cfe4ee', [0, 1.35, 0.3], [1.2, 1.28, 0.01], undefined, 'holo'),
        ...[-1, 1].map((sx) => box('#cfe4ee', [sx * 0.635, 1.35, 0], [0.01, 1.28, 0.56], undefined, 'holo')),
        box(C.walnutLight, [0, 1.35, 0], [1.2, 0.03, 0.55]),
        box(C.screenWarm, [0, 1.94, 0], [1.1, 0.02, 0.4], undefined, 'screen'),
        box('#8b2e2e', [0, 0.78, 0], [0.34, 0.08, 0.26]),
        box('#c9a227', [0, 0.84, 0], [0.3, 0.04, 0.22], [0, 0.15, 0]),
        cyl('#2f6b8a', [0, 1.52, 0], [0.18, 0.3, 0.18], undefined, 'gloss'),
      ];
      for (const sx of [-1, 1]) {
        out.push(cyl('#e8d9b5', [sx * 0.38, 0.8, 0], [0.09, 0.32, 0.09], [Math.PI / 2, 0, 0]));
        out.push(cyl('#a0522d', [sx * 0.38, 1.47, 0], [0.16, 0.2, 0.16], undefined, 'gloss'));
      }
      return out;
    }
    case 'lamp_post':
      // Cột đèn đồng: đế tròn, thân trụ, chụp đèn cầu sáng ấm.
      return [
        cyl('#a96b32', [0, 0.04, 0], [0.36, 0.08, 0.36], undefined, 'gloss'),
        cyl('#cd8c4a', [0, 0.85, 0], [0.07, 1.6, 0.07], undefined, 'gloss'),
        cyl('#a96b32', [0, 1.68, 0], [0.18, 0.06, 0.18], undefined, 'gloss'),
        P('sphere', C.screenWarm, [0, 1.85, 0], [0.3, 0.3, 0.3], undefined, 'screen'),
        cyl('#a96b32', [0, 2.02, 0], [0.12, 0.04, 0.12], undefined, 'gloss'),
      ];
    case 'magazine_rack': {
      // Kệ tạp chí thấp bằng óc chó: ba tầng nghiêng, tạp chí và báo cáo đủ màu.
      const out: Part[] = [box(C.walnut, [0, 0.35, -0.2], [0.5, 0.7, 0.04])];
      for (const sx of [-1, 1]) out.push(box(C.walnut, [sx * 0.24, 0.35, 0], [0.03, 0.7, 0.44]));
      ['#8b2e2e', '#2e4a8b', '#c9a227'].forEach((c, i) => {
        const y = 0.15 + i * 0.22;
        out.push(box(C.walnutLight, [0, y, 0.05 - i * 0.06], [0.46, 0.02, 0.26], [-0.35, 0, 0]));
        out.push(box(c, [0, y + 0.1, 0.02 - i * 0.06], [0.34, 0.2, 0.015], [-0.35, 0, 0]));
      });
      return out;
    }
    case 'floor_lamp':
      return [
        cyl(C.black, [0, 0.02, 0], [0.32, 0.04, 0.32]),
        cyl('#c9a227', [0, 0.8, 0], [0.03, 1.56, 0.03], undefined, 'chrome'),
        P('cone', it.color ?? '#f3e6c8', [0, 1.62, 0], [0.42, 0.32, 0.42]),
        P('sphere', C.screenWarm, [0, 1.55, 0], [0.12, 0.12, 0.12], undefined, 'screen'),
      ];
    case 'armchair': {
      const c = it.color ?? C.leather;
      const seam = new THREE.Color(c).multiplyScalar(0.75).getStyle();
      return [
        box(c, [0, 0.24, 0], [0.9, 0.36, 0.85], undefined, 'gloss'),
        box(c, [0, 0.46, 0.05], [0.66, 0.1, 0.68], undefined, 'gloss'),
        box(c, [0, 0.72, -0.34], [0.9, 0.62, 0.18], [-0.1, 0, 0], 'gloss'),
        ...[-1, 1].map((sx) => box(c, [sx * 0.39, 0.58, 0.02], [0.14, 0.32, 0.82], undefined, 'gloss')),
        ...[0.55, 0.75, 0.95].map((y) => box(seam, [0, y, -0.25], [0.6, 0.012, 0.01], [-0.1, 0, 0])),
      ];
    }
    case 'heart_neon': {
      // Tim neon hồng trên tấm gỗ trắng, đỉnh tấm 2,2 m (dưới bảng tên phòng): hai thuỳ tròn + mũi nhọn (vuông xoay 45°).
      const y = 1.65;
      return [
        box(C.white, [0, y, 0.02], [1.3, 1.1, 0.03]),
        ...[-1, 1].map((sx) => P('sphere', '#ff4fa0', [sx * 0.17, y + 0.1, 0.07], [0.42, 0.42, 0.06], undefined, 'screen')),
        box('#ff4fa0', [0, y - 0.1, 0.07], [0.42, 0.42, 0.06], [0, 0, Math.PI / 4], 'screen'),
      ];
    }
    case 'curtains': {
      // Rèm voan hồng cho một cửa sổ (rộng 1,5 m, đỉnh ≈ 2,3 m): thanh treo vàng, hai vạt rèm vén hai bên, dây buộc.
      const out: Part[] = [cyl('#d4af37', [0, 2.42, 0.12], [0.03, 2.3, 0.03], [0, 0, Math.PI / 2], 'chrome')];
      for (const sx of [-1, 1]) {
        out.push(P('sphere', '#d4af37', [sx * 1.15, 2.42, 0.12], [0.07, 0.07, 0.07], undefined, 'chrome'));
        for (let k = 0; k < 3; k++) out.push(box(k % 2 ? '#f7b6c8' : '#f9c8d6', [sx * (0.88 + k * 0.1), 1.4, 0.1 + (k % 2) * 0.02], [0.12, 2.0, 0.04]));
        out.push(box('#ff6fa3', [sx * 0.98, 1.2, 0.14], [0.34, 0.05, 0.03]));
      }
      return out;
    }
    case 'flower_vase':
      return [
        cyl('#f7b6c8', [0, 0.35, 0], [0.32, 0.7, 0.32], undefined, 'gloss'),
        ...[0, 1, 2, 3, 4].map((i) => cyl('#4f8a4f', [Math.sin(i * 1.3) * 0.07, 0.95, Math.cos(i * 1.3) * 0.07], [0.02, 0.5, 0.02], [Math.cos(i * 1.3) * 0.15, 0, -Math.sin(i * 1.3) * 0.15])),
        ...[0, 1, 2, 3, 4].map((i) => P('sphere', ['#ff4f8b', '#ffffff', '#ff9ec4', '#ffd1e1', '#ff6fa3'][i]!, [Math.sin(i * 1.3) * 0.13, 1.22, Math.cos(i * 1.3) * 0.13], [0.16, 0.14, 0.16])),
      ];
    case 'graffiti_wall': {
      // Phông graffiti rộng 5,6 m căn giữa sau bục DJ; mảng màu đối xứng qua giữa.
      const out: Part[] = [box('#2a2a33', [0, 1.5, 0.02], [5.6, 3.0, 0.03])];
      const paint = ['#ff3d7f', '#ffd23f', '#3ee8ff', '#7cff6b', '#b14cff', '#ff8a3d'];
      for (let i = 0; i < 9; i++) {
        const x = 0.35 + ((i * 37) % 23) / 10;
        const y = 0.5 + ((i * 53) % 21) / 10;
        const c = paint[i % paint.length]!;
        const r = ((i * 29) % 13) / 10 - 0.6;
        for (const sx of [-1, 1]) out.push(box(c, [sx * x, y, 0.04], [0.35 + (i % 4) * 0.2, 0.12 + (i % 3) * 0.09, 0.01], [0, 0, sx * r]));
      }
      return out;
    }
    case 'neon_crown':
      return [
        box('#ffd23f', [0, 2.4, 0.07], [0.9, 0.06, 0.03], undefined, 'screen'),
        ...[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) => box('#ffd23f', [x, 2.6 + (i % 2 ? -0.05 : 0.05), 0.07], [0.05, i % 2 ? 0.3 : 0.42, 0.03], [0, 0, x * -0.6], 'screen')),
        ...[-0.4, 0, 0.4].map((x) => P('sphere', '#ffd23f', [x, 2.86, 0.07], [0.08, 0.08, 0.04], undefined, 'screen')),
      ];
    case 'dj_stage': {
      // Bục DJ: sàn nâng 0,25 m viền LED, bàn DJ đen bóng hai mâm đĩa + bàn trộn ở giữa.
      const h = 0.25;
      return [
        box('#18181c', [0, h / 2, 0], [2.4, h, 1.5], undefined, 'gloss'),
        box('#00b7ff', [0, h - 0.01, 0.755], [2.4, 0.02, 0.01], undefined, 'screen'),
        ...[-1, 1].map((sx) => box('#00b7ff', [sx * 1.205, h - 0.01, 0], [0.01, 0.02, 1.5], undefined, 'screen')),
        box('#18181c', [0, h + 0.48, -0.1], [1.4, 0.96, 0.72], undefined, 'gloss'),
        box('#b14cff', [0, h + 0.5, 0.265], [1.36, 0.06, 0.01], undefined, 'screen'),
        ...[-0.42, 0.42].flatMap((x) => [
          box(C.charcoal, [x, h + 0.99, -0.1], [0.46, 0.04, 0.46]),
          cyl(C.black, [x, h + 1.02, -0.1], [0.38, 0.02, 0.38], undefined, 'gloss'),
          cyl(C.silver, [x, h + 1.035, -0.1], [0.08, 0.01, 0.08], undefined, 'chrome'),
        ]),
        box(C.charcoal, [0, h + 1.0, -0.1], [0.26, 0.05, 0.4]),
        ...[-0.06, 0, 0.06].map((x) => box('#3ee8ff', [x, h + 1.03, -0.05], [0.02, 0.01, 0.16], undefined, 'screen')),
      ];
    }
    case 'led_column':
      // Cột đèn LED đứng: đế đen, các đoạn sáng tím/xanh xen kẽ.
      return [
        cyl('#111114', [0, 0.04, 0], [0.32, 0.08, 0.32], undefined, 'gloss'),
        ...Array.from({ length: 6 }, (_, i) => cyl(i % 2 ? '#00b7ff' : '#b14cff', [0, 0.25 + i * 0.32, 0], [0.16, 0.3, 0.16], undefined, 'screen')),
        cyl('#111114', [0, 2.2, 0], [0.2, 0.06, 0.2], undefined, 'gloss'),
      ];
    case 'speaker':
      return [
        box('#111114', [0, 0.85, 0], [0.55, 1.7, 0.5], undefined, 'gloss'),
        cyl(C.charcoal, [0, 0.5, 0.255], [0.4, 0.02, 0.4], [Math.PI / 2, 0, 0]),
        cyl(C.charcoal, [0, 1.15, 0.255], [0.26, 0.02, 0.26], [Math.PI / 2, 0, 0]),
        cyl(C.charcoal, [0, 1.5, 0.255], [0.12, 0.02, 0.12], [Math.PI / 2, 0, 0]),
        P('ring', '#b14cff', [0, 0.5, 0.27], [0.42, 0.42, 2], [0, 0, 0], 'screen'),
        P('ring', '#00b7ff', [0, 1.15, 0.27], [0.28, 0.28, 2], [0, 0, 0], 'screen'),
      ];
    default:
      return [];
  }
}

function partsOf(it: Exclude<Item, { kind: 'kenney' }>): Part[] {
  switch (it.kind) {
    case 'sofa': {
      const pillow = new THREE.Color(it.color).offsetHSL(0, -0.1, 0.18).getStyle();
      return [
        ...[-1, 1].map((sx) => cyl(C.chrome, [sx * 0.95, 0.05, 0.05], [0.05, 0.1, 0.05], undefined, 'chrome')),
        box(it.color, [0, 0.27, 0.02], [2.2, 0.32, 0.86], undefined, 'gloss'),
        ...[-0.72, 0, 0.72].map((x) => box(it.color, [x, 0.48, 0.07], [0.7, 0.12, 0.68], undefined, 'gloss')),
        ...[-0.72, 0, 0.72].map((x) => box(it.color, [x, 0.72, -0.27], [0.7, 0.42, 0.16], [-0.12, 0, 0], 'gloss')),
        box(it.color, [0, 0.6, -0.38], [2.2, 0.62, 0.12]),
        ...[-1, 1].map((sx) => box(it.color, [sx * 1.04, 0.56, 0.02], [0.14, 0.22, 0.86], undefined, 'gloss')),
        ...[-1, 1].map((sx) => box(pillow, [sx * 0.78, 0.68, -0.14], [0.36, 0.32, 0.1], [-0.25, sx * 0.25, sx * 0.12])),
      ];
    }
    case 'rug':
      return it.round ? [cyl(it.color, [0, 0.025, 0], [it.w, 0.01, it.d])] : [box(it.color, [0, 0.025, 0], [it.w, 0.01, it.d])];
    case 'workstation':
      return workstation(it.style);
    case 'meeting_platform':
      return [
        cyl('#2a303b', [0, 0.02, 0], [6.6, 0.04, 6.6], undefined, 'gloss'),
        P('ring', C.cyan, [0, 0.045, 0], [6.6, 6.6, 1], [-Math.PI / 2, 0, 0], 'screen'),
        P('ring', C.cyan, [0, 0.045, 0], [4.4, 4.4, 1], [-Math.PI / 2, 0, 0], 'screen'),
      ];
    case 'meeting_table':
      return [
        cyl(C.white, [0, 0.76, 0], [3.2, 0.07, 3.2], undefined, 'gloss'),
        P('ring', C.cyan, [0, 0.725, 0], [3.16, 3.16, 1.4], [-Math.PI / 2, 0, 0], 'screen'),
        cyl(C.white, [0, 0.68, 0], [2.6, 0.08, 2.6], undefined, 'gloss'),
        P('cone', C.white, [0, 0.36, 0], [1.4, 0.6, 1.4], [Math.PI, 0, 0], 'gloss'),
        cyl(C.chrome, [0, 0.05, 0], [1.6, 0.06, 1.6], undefined, 'chrome'),
        // Bệ máy chiếu hologram giữa bàn.
        cyl('#2a303b', [0, 0.82, 0], [0.5, 0.05, 0.5], undefined, 'gloss'),
        cyl(C.cyan, [0, 0.85, 0], [0.38, 0.01, 0.38], undefined, 'screen'),
      ];
    case 'hologram':
      return [
        P('cone', C.cyan, [0, 1.2, 0], [0.9, 0.7, 0.9], undefined, 'holo'),
        P('sphere', C.cyan, [0, 1.62, 0], [0.42, 0.42, 0.42], undefined, 'holo'),
        P('ring', C.cyan, [0, 1.62, 0], [0.62, 0.62, 1], [-Math.PI / 2 + 0.3, 0, 0], 'screen'),
      ];
    case 'meeting_chair':
      // Ghế vỏ trứng: vỏ trắng bóng ôm lưng, đệm xám, viền đèn xanh, chân chrome.
      return [
        cyl(C.chrome, [0, 0.03, -0.05], [0.6, 0.04, 0.6], undefined, 'chrome'),
        cyl(C.chrome, [0, 0.22, -0.05], [0.09, 0.36, 0.09], undefined, 'chrome'),
        P('shell', C.white, [0, 0.72, -0.05], [0.86, 1.05, 0.86], undefined, 'gloss'),
        box('#3a414d', [0, 0.46, 0.0], [0.56, 0.1, 0.52]),
        box('#3a414d', [0, 0.72, -0.26], [0.4, 0.4, 0.08], [-0.15, 0, 0]),
        P('ring', C.cyan, [0, 0.42, -0.05], [0.84, 0.84, 1], [-Math.PI / 2, 0, 0], 'screen'),
      ];
    case 'whiteboard': {
      const notes = ['#ffd166', '#f7a1b5', '#8fd0ec', '#b7e07b', '#ffd166', '#f7a1b5'];
      return [
        box(C.silver, [0, 1.55, 0.03], [3.6, 1.25, 0.04]),
        box(C.white, [0, 1.55, 0.055], [3.5, 1.15, 0.01], undefined, 'gloss'),
        box(C.silver, [0, 0.95, 0.09], [3.0, 0.03, 0.08]),
        ...notes.map((c, i) => box(c, [-1.4 + i * 0.56, 1.7 + (i % 2) * 0.3, 0.065], [0.36, 0.36, 0.01])),
        box(C.charcoal, [-0.6, 1.25, 0.065], [1.4, 0.015, 0.01]),
      ];
    }
    case 'green_cyc':
      // Phông xanh phủ tường tây, uốn cong xuống sàn (cove) và trải sàn trước bục sản phẩm.
      return [
        box(C.green, [0.05, 1.5, 0], [0.06, 2.9, 7]),
        box(C.green, [0.18, 0.12, 0], [0.32, 0.06, 7], [0, 0, -0.75]),
        box(C.green, [1.7, 0.012, 0], [3.2, 0.012, 7]),
        ...[-3.6, 3.6].map((z) => box(C.charcoal, [0.08, 1.5, z], [0.1, 3.0, 0.1])),
      ];
    case 'camera_rig':
      return [
        ...[0, 2.09, 4.19].map((a) => box(C.charcoal, [Math.sin(a) * 0.22, 0.6, Math.cos(a) * 0.22], [0.03, 1.25, 0.03], [Math.cos(a) * 0.34, 0, -Math.sin(a) * 0.34])),
        cyl(C.charcoal, [0, 1.2, 0], [0.05, 0.3, 0.05]),
        box(C.black, [0, 1.45, 0], [0.18, 0.2, 0.3]),
        cyl(C.black, [0, 1.47, 0.24], [0.12, 0.2, 0.12], [Math.PI / 2, 0, 0]),
        cyl('#2a4d7a', [0, 1.47, 0.345], [0.09, 0.01, 0.09], [Math.PI / 2, 0, 0], 'gloss'),
        box(C.black, [0.12, 1.55, -0.12], [0.02, 0.12, 0.16]),
        box(C.screen, [0.13, 1.55, -0.12], [0.005, 0.1, 0.14], undefined, 'screen'),
      ];
    case 'softbox':
      return [
        ...[0, 2.09, 4.19].map((a) => box(C.charcoal, [Math.sin(a) * 0.25, 0.35, Math.cos(a) * 0.25], [0.03, 0.75, 0.03], [Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6])),
        cyl(C.charcoal, [0, 1.0, 0], [0.04, 1.4, 0.04]),
        box(C.black, [0, 1.85, -0.05], [0.75, 0.75, 0.32]),
        box('#fffaf0', [0, 1.85, 0.115], [0.7, 0.7, 0.01], undefined, 'screen'),
      ];
    case 'product_shelf': {
      const colors = ['#ff6b6b', '#ffd166', '#4d96ff', '#06d6a0', '#f7a1b5', '#c3a6ff'];
      const out: Part[] = [];
      for (const sx of [-1, 1]) out.push(box(C.charcoal, [sx * 1.2, 0.95, 0], [0.05, 1.9, 0.45]));
      for (const y of [0.1, 0.6, 1.1, 1.6]) {
        out.push(box(C.oak, [0, y, 0], [2.4, 0.04, 0.45]));
        if (y < 1.6) for (let i = 0; i < 6; i++) out.push(box(colors[(i + Math.round(y * 10)) % colors.length]!, [-0.95 + i * 0.38, y + 0.14, 0], [0.22, 0.24, 0.22], undefined, 'gloss'));
      }
      return out;
    }
    case 'beanbag':
      return [P('sphere', it.color ?? C.yellow, [0, 0.28, 0], [0.9, 0.56, 0.9])];
    case 'sofa_arc': {
      const c = '#e8e2d6';
      return [
        box(C.charcoal, [0, 0.05, 0], [0.7, 0.06, 0.6]),
        box(c, [0, 0.27, 0.02], [0.82, 0.34, 0.76], undefined, 'gloss'),
        box('#f3eee4', [0, 0.49, 0.08], [0.8, 0.1, 0.6]),
        box(c, [0, 0.7, -0.31], [0.82, 0.56, 0.16]),
        box('#f3eee4', [0, 0.72, -0.21], [0.76, 0.36, 0.08], [-0.15, 0, 0]),
        box('#cfc6b6', [0.41, 0.4, 0.02], [0.01, 0.5, 0.76]),
      ];
    }
    case 'round_coffee':
      // Bàn nước tròn lớn (đường kính 1,8 m): mặt đá trắng, viền chrome, chân trụ, khay đồ uống và sản phẩm mẫu.
      return [
        cyl('#f2efe9', [0, 0.44, 0], [1.8, 0.05, 1.8], undefined, 'gloss'),
        cyl(C.chrome, [0, 0.41, 0], [1.82, 0.02, 1.82], undefined, 'chrome'),
        cyl(C.chrome, [0, 0.22, 0], [0.16, 0.42, 0.16], undefined, 'chrome'),
        cyl(C.chrome, [0, 0.02, 0], [0.9, 0.03, 0.9], undefined, 'chrome'),
        cyl(C.charcoal, [0.35, 0.475, 0.1], [0.5, 0.015, 0.5], undefined, 'gloss'),
        ...[0, 1.6, 3.2].map((a) => cyl('#f0c05a', [0.35 + Math.sin(a) * 0.13, 0.54, 0.1 + Math.cos(a) * 0.13], [0.08, 0.12, 0.08], undefined, 'gloss')),
        cyl('#ff6b6b', [-0.35, 0.56, -0.15], [0.12, 0.2, 0.12], undefined, 'gloss'),
        box('#ffd166', [-0.3, 0.53, 0.3], [0.2, 0.14, 0.14], undefined, 'gloss'),
        box('#e8e2d6', [0.05, 0.475, -0.45], [0.3, 0.02, 0.22]),
      ];
    case 'bar_round': {
      // Quầy bar tròn (bán kính ngoài BAR_RADIUS, thân quầy ở BAR_RADIUS - 0,35): thân gỗ tối ốp lam, mặt đá trắng, dải đèn chân quầy, thanh để chân chrome; lối ra vào ở
      // giữa phía nam (+Z, quay về camera) có cửa lò xo hai cánh mở ra mở vào.
      const out: Part[] = [];
      const R = BAR_RADIUS - 0.35;
      const gap = 0.25;
      const N = 56;
      // Ly bày trên quầy: đoạn i và ảnh gương N-1-i qua trục quầy.
      const glasses = new Set([3, 10, 17, 24].flatMap((i) => [i, N - 1 - i]));
      for (let i = 0; i < N; i++) {
        const a = gap + (i + 0.5) * ((2 * Math.PI - 2 * gap) / N);
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        const seg = (2 * Math.PI * R) / N + 0.03;
        out.push(box('#3b2a20', [sx * R, 0.52, sz * R], [seg, 1.0, 0.6], [0, a, 0]));
        out.push(box('#4a3528', [sx * (R + 0.305), 0.52, sz * (R + 0.305)], [seg * 0.55, 0.9, 0.02], [0, a, 0]));
        out.push(box('#efece6', [sx * (R + 0.05), 1.06, sz * (R + 0.05)], [seg + 0.03, 0.06, 0.8], [0, a, 0], 'gloss'));
        // Mặt quầy phía trong (pha chế) thấp hơn một bậc.
        out.push(box('#2b2e33', [sx * (R - 0.42), 0.9, sz * (R - 0.42)], [seg * 0.85, 0.04, 0.3], [0, a, 0], 'gloss'));
        out.push(box('#ffb347', [sx * (R + 0.32), 0.06, sz * (R + 0.32)], [seg, 0.03, 0.02], [0, a, 0], 'screen'));
        out.push(box(C.chrome, [sx * (R + 0.46), 0.25, sz * (R + 0.46)], [seg, 0.03, 0.03], [0, a, 0], 'chrome'));
        if (glasses.has(i)) out.push(cyl('#f0c05a', [sx * (R + 0.2), 1.17, sz * (R + 0.2)], [0.09, 0.16, 0.09], undefined, 'gloss'));
      }
      // Cửa lò xo hai cánh (kiểu saloon) trong khe quầy: trụ bản lề hai bên, mỗi cánh nửa khe, nan chớp, khe giữa hai cánh.
      const span = 2 * R * Math.sin(gap);
      const zc = R * Math.cos(gap);
      for (const sx of [-1, 1]) {
        out.push(box('#2b1f18', [sx * (span / 2 - 0.03), 0.55, zc], [0.06, 1.1, 0.1]));
        out.push(cyl(C.chrome, [sx * (span / 2 - 0.07), 0.8, zc], [0.03, 0.08, 0.03], undefined, 'chrome'));
        out.push(cyl(C.chrome, [sx * (span / 2 - 0.07), 0.3, zc], [0.03, 0.08, 0.03], undefined, 'chrome'));
        const leaf = span / 2 - 0.1;
        const cx = sx * (span / 2 - 0.08 - leaf / 2);
        out.push(box('#4a3528', [cx, 0.55, zc], [leaf, 0.8, 0.04], undefined, 'gloss'));
        for (let k = 0; k < 4; k++) out.push(box('#3b2a20', [cx, 0.3 + k * 0.17, zc + 0.025], [leaf - 0.06, 0.05, 0.01]));
        out.push(box('#c9a227', [cx, 0.96, zc], [leaf, 0.03, 0.05], undefined, 'chrome'));
      }
      return out;
    }
    case 'bar_tower': {
      // Tháp kệ rượu giữa quầy: tủ tròn, ba tầng kệ chai phát sáng, đỉnh có vòng neon (không có đèn trần).
      const bottles = ['#7fd3a5', '#c96a3b', '#e8d27a', '#8a3b2e', '#b9e3f2', '#5b8f4a', '#d98b5f'];
      const out: Part[] = [cyl('#2f2620', [0, 0.45, 0], [1.5, 0.9, 1.5]), cyl('#1d1f23', [0, 1.45, 0], [0.6, 1.1, 0.6], undefined, 'gloss')];
      for (const y of [1.15, 1.55, 1.95]) {
        out.push(cyl('#4a3528', [0, y, 0], [1.25, 0.04, 1.25]));
        out.push(P('ring', '#ffb347', [0, y - 0.02, 0], [1.25, 1.25, 1], [-Math.PI / 2, 0, 0], 'screen'));
        for (let i = 0; i < 14; i++) {
          const a = (i * Math.PI) / 7 + y;
          out.push(cyl(bottles[(i + Math.round(y * 10)) % bottles.length]!, [Math.sin(a) * 0.48, y + 0.15, Math.cos(a) * 0.48], [0.08, 0.26, 0.08], undefined, 'gloss'));
        }
      }
      out.push(cyl('#4a3528', [0, 2.06, 0], [1.25, 0.06, 1.25]));
      out.push(P('ring', '#ff4fa3', [0, 2.1, 0], [1.3, 1.3, 2], [-Math.PI / 2, 0, 0], 'screen'));
      return out;
    }
    case 'coffee_table':
      // Bàn trà mặt kính khói, khung chrome.
      return [
        box('#5a6470', [0, 0.42, 0], [1.2, 0.03, 0.7], undefined, 'gloss'),
        ...[-1, 1].flatMap((sx) => [box(C.chrome, [sx * 0.55, 0.2, 0], [0.03, 0.4, 0.66], undefined, 'chrome')]),
        box(C.walnutLight, [0, 0.12, 0], [1.1, 0.03, 0.62]),
        box('#e8e2d6', [0.2, 0.45, 0.05], [0.28, 0.02, 0.2]),
      ];
    case 'bar_stool':
      return [
        cyl(C.chrome, [0, 0.02, 0], [0.42, 0.03, 0.42], undefined, 'chrome'),
        cyl(C.chrome, [0, 0.38, 0], [0.06, 0.72, 0.06], undefined, 'chrome'),
        P('ring', C.chrome, [0, 0.3, 0], [0.38, 0.38, 2], [-Math.PI / 2, 0, 0], 'chrome'),
        cyl('#7a3b2a', [0, 0.77, 0], [0.42, 0.08, 0.42]),
        box('#7a3b2a', [0, 0.95, -0.17], [0.34, 0.28, 0.05]),
      ];
    case 'booth_bench': {
      const c = '#8a2f2a';
      return [
        box('#3b2a20', [0, 0.22, 0], [1.9, 0.44, 0.55]),
        box(c, [0, 0.47, 0.03], [1.86, 0.1, 0.5]),
        box(c, [0, 0.85, -0.22], [1.9, 0.75, 0.14]),
        ...[-0.62, 0, 0.62].map((x) => box('#9c3a33', [x, 0.88, -0.14], [0.56, 0.62, 0.04])),
      ];
    }
    case 'booth_table':
      return [box('#4a3528', [0, 0.74, 0], [1.5, 0.05, 0.84], undefined, 'gloss'), cyl(C.charcoal, [0, 0.37, 0], [0.12, 0.72, 0.12]), box(C.charcoal, [0, 0.02, 0], [0.8, 0.04, 0.5]),
        cyl('#f0c05a', [-0.35, 0.84, 0.1], [0.09, 0.16, 0.09], undefined, 'gloss'), cyl('#f0c05a', [0.3, 0.84, -0.12], [0.09, 0.16, 0.09], undefined, 'gloss'),
        cyl('#ffcf70', [0, 0.82, 0], [0.08, 0.1, 0.08], undefined, 'screen')];
    case 'tv_wall': {
      // TV lớn treo tường trên tủ kệ thấp gỗ óc chó; màn hình hiển thị bảng số liệu chiến dịch.
      const out: Part[] = [
        box(C.walnut, [0, 0.25, 0.25], [2.9, 0.5, 0.45], undefined, 'gloss'),
        ...[-1, 0, 1].map((k) => box(C.walnutLight, [k * 0.96, 0.25, 0.476], [0.9, 0.42, 0.01])),
        box(C.chrome, [0, 0.03, 0.25], [2.8, 0.06, 0.4], undefined, 'chrome'),
        box(C.black, [0, 1.45, 0.06], [2.7, 1.5, 0.06], undefined, 'gloss'),
        box('#13233a', [0, 1.45, 0.092], [2.6, 1.4, 0.004], undefined, 'screen'),
      ];
      // Nội dung màn hình: thanh biểu đồ, đường xu hướng, ô số liệu.
      [0.35, 0.55, 0.42, 0.7, 0.6, 0.85].forEach((h, i) => out.push(box(i % 2 ? '#5ce1ff' : '#ffd23f', [-1.0 + i * 0.2, 0.95 + h / 2, 0.096], [0.12, h, 0.004], undefined, 'screen')));
      for (let i = 0; i < 3; i++) out.push(box('#2c4a6e', [0.55 + i * 0.32, 1.85, 0.096], [0.26, 0.3, 0.004], undefined, 'screen'));
      out.push(box('#ff6b9a', [0.85, 1.2, 0.097], [0.9, 0.03, 0.004], [0, 0, 0.35], 'screen'));
      out.push(box('#e8e2d6', [0.9, 0.53, 0.25], [0.3, 0.06, 0.2]));
      out.push(P('sphere', '#c9a227', [-1.0, 0.6, 0.25], [0.2, 0.2, 0.2], undefined, 'chrome'));
      return out;
    }
    case 'cyc_truss': {
      // Giàn khung nhôm đen quanh phông xanh: hai trụ, thanh ngang trên, ba đèn spot chiếu xuống bục sản phẩm, dải LED.
      const out: Part[] = [];
      for (const z of [-3.75, 3.75]) {
        out.push(box(C.charcoal, [0.45, 1.5, z], [0.12, 3.0, 0.12], undefined, 'chrome'));
        out.push(box(C.charcoal, [0.45, 0.02, z], [0.5, 0.04, 0.5], undefined, 'chrome'));
      }
      out.push(box(C.charcoal, [0.45, 2.95, 0], [0.12, 0.12, 7.62], undefined, 'chrome'));
      out.push(box(C.charcoal, [1.2, 2.95, 0], [0.08, 0.08, 7.62], undefined, 'chrome'));
      for (const z of [-3.75, 0, 3.75]) out.push(box(C.charcoal, [0.82, 2.95, z], [0.8, 0.06, 0.06], undefined, 'chrome'));
      for (const z of [-1.2, 0, 1.2]) {
        out.push(cyl(C.black, [1.2, 2.7, z], [0.2, 0.32, 0.2], [0.6, 0, 0]));
        out.push(cyl('#fffaf0', [1.32, 2.56, z], [0.16, 0.01, 0.16], [0.6, 0, 0], 'screen'));
      }
      out.push(box('#d9fbe0', [0.12, 2.82, 0], [0.04, 0.04, 7.2], undefined, 'screen'));
      // Vạch đánh dấu vị trí trên sàn xanh.
      for (const [x, z] of [[1.4, -1.1], [1.4, 1.1], [2.4, 0]] as const) {
        out.push(box('#ffd23f', [x, 0.03, z], [0.3, 0.005, 0.05], [0, 0.785, 0], 'screen'));
        out.push(box('#ffd23f', [x, 0.03, z], [0.3, 0.005, 0.05], [0, -0.785, 0], 'screen'));
      }
      return out;
    }
    case 'product_set': {
      // Cụm bục sản phẩm ba tầng cao thấp, sản phẩm mẫu và đạo cụ.
      const out: Part[] = [
        cyl(C.white, [0, 0.4, 0], [0.8, 0.8, 0.8], undefined, 'gloss'),
        cyl(C.white, [-0.6, 0.25, 0.1], [0.55, 0.5, 0.55], undefined, 'gloss'),
        cyl(C.white, [0.6, 0.55, -0.05], [0.5, 1.1, 0.5], undefined, 'gloss'),
        cyl('#ff6b6b', [0, 0.97, 0], [0.18, 0.34, 0.18], undefined, 'gloss'),
        cyl(C.white, [0, 1.18, 0], [0.07, 0.08, 0.07]),
        box('#ffd166', [-0.6, 0.62, 0.1], [0.24, 0.24, 0.24], [0, 0.4, 0], 'gloss'),
        cyl('#4d96ff', [0.6, 1.18, -0.05], [0.2, 0.16, 0.2], undefined, 'gloss'),
        P('sphere', '#c3a6ff', [0.25, 0.86, 0.25], [0.12, 0.12, 0.12], undefined, 'gloss'),
        P('cone', '#7fd3a5', [-0.3, 0.9, -0.25], [0.14, 0.2, 0.14], undefined, 'gloss'),
      ];
      return out;
    }
    case 'led_panel':
      return [
        ...[0, 2.09, 4.19].map((a) => box(C.charcoal, [Math.sin(a) * 0.22, 0.32, Math.cos(a) * 0.22], [0.03, 0.7, 0.03], [Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6])),
        cyl(C.charcoal, [0, 0.95, 0], [0.04, 1.3, 0.04]),
        box(C.charcoal, [0, 1.75, 0], [0.7, 0.45, 0.06]),
        box('#e8f4ff', [0, 1.75, 0.032], [0.64, 0.4, 0.005], undefined, 'screen'),
      ];
    case 'reflector':
      return [
        cyl(C.charcoal, [0, 0.5, 0], [0.03, 1.0, 0.03]),
        cyl(C.charcoal, [0, 0.02, 0], [0.4, 0.03, 0.4]),
        cyl('#e6e9ee', [0, 1.1, 0], [0.8, 0.02, 0.8], [Math.PI / 2 - 0.3, 0, 0], 'chrome'),
      ];
    case 'field_monitor':
      return [
        cyl(C.charcoal, [0, 0.6, 0], [0.03, 1.2, 0.03]),
        cyl(C.charcoal, [0, 0.02, 0], [0.4, 0.03, 0.4]),
        box(C.black, [0, 1.3, 0], [0.42, 0.28, 0.05]),
        box('#9fd4ff', [0, 1.3, 0.027], [0.38, 0.24, 0.004], undefined, 'screen'),
        box('#3fbf5a', [0, 1.26, 0.03], [0.36, 0.1, 0.003], undefined, 'screen'),
      ];
    case 'library_wall':
    case 'statue':
    case 'display_case':
    case 'lamp_post':
    case 'magazine_rack':
    case 'curtains':
    case 'led_column':
    case 'floor_lamp':
    case 'armchair':
    case 'heart_neon':
    case 'flower_vase':
    case 'graffiti_wall':
    case 'neon_crown':
    case 'dj_stage':
    case 'speaker':
      return decorParts(it);
    case 'wall_tv':
      return [box(C.black, [0, 1.6, 0.04], [1.6, 0.9, 0.05]), box(C.screen, [0, 1.6, 0.068], [1.52, 0.82, 0.005], undefined, 'screen')];
  }
}

// ---------------- Gộp thành InstancedMesh ----------------

const GEOMETRY: Record<Shape, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  sphere: new THREE.SphereGeometry(0.5, 20, 14),
  // Nửa sau của quả cầu (z ≤ 0): vỏ ghế ôm lưng.
  shell: new THREE.SphereGeometry(0.5, 24, 16, Math.PI, Math.PI),
  // Vòng mảnh nằm trong mặt XY, bán kính 0,5; xoay -π/2 quanh X để nằm ngang.
  ring: new THREE.TorusGeometry(0.5, 0.012, 6, 64),
  cone: new THREE.ConeGeometry(0.5, 1, 24, 1, true),
};

interface Batch {
  shape: Shape;
  mat: Mat;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

function batches(items: Item[]): Batch[] {
  const map = new Map<string, Batch>();
  const itemM = new THREE.Matrix4();
  const partM = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const it of items) {
    if (it.kind === 'kenney') continue;
    itemM.compose(new THREE.Vector3(it.x, 0, it.z), q.setFromEuler(e.set(0, it.rot, 0)), new THREE.Vector3(1, 1, 1));
    for (const part of partsOf(it)) {
      const key = `${part.shape}:${part.mat}`;
      let b = map.get(key);
      if (!b) map.set(key, (b = { shape: part.shape, mat: part.mat, matrices: [], colors: [] }));
      partM.compose(new THREE.Vector3(...part.p), q.setFromEuler(e.set(...(part.r ?? [0, 0, 0]))), new THREE.Vector3(...part.s));
      b.matrices.push(new THREE.Matrix4().multiplyMatrices(itemM, partM));
      b.colors.push(new THREE.Color(part.color));
    }
  }
  return [...map.values()];
}

function BatchMesh({ batch }: { batch: Batch }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    batch.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, batch.colors[i]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [batch]);
  const glow = batch.mat === 'screen' || batch.mat === 'holo';
  return (
    <instancedMesh
      key={batch.matrices.length}
      ref={ref}
      args={[GEOMETRY[batch.shape], undefined, batch.matrices.length]}
      castShadow={!glow}
      receiveShadow={!glow}
      renderOrder={batch.mat === 'holo' ? 3 : 0}
    >
      {batch.mat === 'screen' && <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />}
      {batch.mat === 'holo' && <meshBasicMaterial toneMapped={false} transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />}
      {batch.mat === 'chrome' && <meshStandardMaterial roughness={0.22} metalness={0.85} />}
      {batch.mat === 'gloss' && <meshStandardMaterial roughness={0.28} metalness={0.05} side={THREE.DoubleSide} />}
      {batch.mat === 'matte' && <meshStandardMaterial roughness={0.8} />}
    </instancedMesh>
  );
}

export function Furniture({ moduleCount }: { moduleCount: number }) {
  const plan = planFor(moduleCount);
  const procedural = useMemo(() => batches(plan.items), [plan]);
  const kenney = useMemo(() => {
    const by = new Map<KenneyModel, Placement[]>();
    for (const it of plan.items) {
      if (it.kind !== 'kenney') continue;
      by.set(it.model, [...(by.get(it.model) ?? []), { x: it.x, z: it.z, y: it.y, rotY: it.rot, scale: it.scale }]);
    }
    return [...by];
  }, [plan]);
  return (
    <group>
      {procedural.map((b) => (
        <BatchMesh key={`${b.shape}:${b.mat}`} batch={b} />
      ))}
      {kenney.map(([name, items]) => (
        <KitInstances key={name} name={name} items={items} />
      ))}
    </group>
  );
}
