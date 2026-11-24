// Vỏ tòa nhà theo mặt bằng (office/plan.ts): sàn từng phòng, tường ngoài cao (bắc/tây/đông) ốp lam có cửa sổ, vách kính khung
// đen có cửa, bảng tên phòng và quầng sáng ấm. Mặt nam để trống (cutaway) cho camera nhìn vào. Khối lặp lại vẽ bằng InstancedMesh.

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BUILDING, DOOR_WIDTH, extentFor, planFor, rectCenter, wallSegments, type Room, type Segment } from '../office/plan.ts';
import { BUILDING_COLORS, ROOM_FLOORS } from './palette.ts';

export const WALL_H = 3;
const WALL_T = 0.2;
const PARTITION_H = 1.1;
const FRAME_H = 1.75;
const SIGN_H = 0.5;

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color?: string;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const tmp = new THREE.Object3D();
const tint = new THREE.Color();

/** Hộp chữ nhật đặt theo tâm đáy (x, y, z); một draw call cho cả nhóm. */
function Boxes({
  items,
  color = '#ffffff',
  roughness = 0.85,
  glass = false,
  castShadow = true,
  receiveShadow = true,
}: {
  items: Box[];
  color?: string;
  roughness?: number;
  glass?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((b, i) => {
      tmp.position.set(b.x, b.y, b.z);
      tmp.scale.set(b.w, b.h, b.d);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      if (b.color) mesh.setColorAt(i, tint.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[unitBox, undefined, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} renderOrder={glass ? 2 : 0}>
      {glass ? (
        <meshStandardMaterial color={color} roughness={0.1} metalness={0.1} transparent opacity={0.22} depthWrite={false} />
      ) : (
        <meshStandardMaterial color={color} roughness={roughness} />
      )}
    </instancedMesh>
  );
}

const alongX = (a: number, b: number, z: number, y: number, h: number, d: number): Box => ({ x: (a + b) / 2, y, z, w: b - a, h, d });
const alongZ = (a: number, b: number, x: number, y: number, h: number, w: number): Box => ({ x, y, z: (a + b) / 2, w, h, d: b - a });
const segBox = (s: Segment, y: number, h: number, t: number): Box =>
  s.z0 === s.z1 ? alongX(s.x0, s.x1, s.z0, y, h, t) : alongZ(s.z0, s.z1, s.x0, y, h, t);

/** Cạnh trùng tường ngoài cao, hoặc mặt nam của hàng trước (để trống cho camera): không dựng vách. */
function isOpenOrOuter(s: Segment): boolean {
  if (s.side === 'n' && s.z0 === BUILDING.z0) return true;
  if (s.side === 'w' && s.x0 === BUILDING.x0 && s.z1 <= BUILDING.z1) return true;
  if (s.side === 'e' && s.x0 === BUILDING.x1 && s.z1 <= BUILDING.z1) return true;
  return s.side === 's' && s.z0 >= BUILDING.z1;
}

/** Cửa sổ trên tường ngoài: [tường, toạ độ dọc tường]. */
const WINDOWS: readonly ['n' | 'w' | 'e', number][] = [
  ['n', -14.6],
  ['n', -7.4],
  ['n', -2.8],
  ['n', 2.8],
  ['n', 7.4],
  ['n', 14.6],
  ['w', -11],
  ['e', -11],
  ['e', -2.2],
  ['e', 2.2],
];

function shell(moduleCount: number) {
  const plan = planFor(moduleCount);
  const ext = extentFor(moduleCount);
  const B = BUILDING;
  const floors: Box[] = [];
  const walls: Box[] = [];
  const slats: Box[] = [];
  const trims: Box[] = [];
  const glass: Box[] = [];
  const frames: Box[] = [];
  const windowGlass: Box[] = [];
  const lamps: Box[] = [];

  // Nền chung (hành lang) dưới mọi phòng.
  floors.push({ x: (ext.x0 + ext.x1) / 2, y: -0.3, z: (ext.z0 - WALL_T + ext.z1) / 2, w: ext.x1 - ext.x0 + 2 * WALL_T, h: 0.3, d: ext.z1 - ext.z0 + WALL_T, color: BUILDING_COLORS.corridor });
  for (const room of plan.rooms) {
    const r = room.rect;
    const c = rectCenter(r);
    floors.push({ x: c.x, y: 0, z: c.z, w: r.x1 - r.x0, h: 0.015, d: r.z1 - r.z0, color: ROOM_FLOORS[room.id.startsWith('general:') ? 'general_workspace' : (room.id as keyof typeof ROOM_FLOORS)] });
  }

  // Tường ngoài cao: bắc, tây, đông của tòa nhà chính; ốp lam, chân tường và nẹp đỉnh màu tối.
  walls.push(alongX(B.x0 - WALL_T, B.x1 + WALL_T, B.z0 - WALL_T / 2, 0, WALL_H, WALL_T));
  walls.push(alongZ(B.z0, B.z1, B.x0 - WALL_T / 2, 0, WALL_H, WALL_T));
  walls.push(alongZ(B.z0, B.z1, B.x1 + WALL_T / 2, 0, WALL_H, WALL_T));
  for (let x = B.x0 + 0.25; x < B.x1; x += 0.5) slats.push({ x, y: 0.12, z: B.z0 + 0.012, w: 0.08, h: WALL_H - 0.24, d: 0.024 });
  for (let z = B.z0 + 0.25; z < B.z1; z += 0.5) for (const x of [B.x0 + 0.012, B.x1 - 0.012]) slats.push({ x, y: 0.12, z, w: 0.024, h: WALL_H - 0.24, d: 0.08 });
  trims.push(alongX(B.x0, B.x1, B.z0 + 0.03, 0, 0.1, 0.06), alongX(B.x0 - WALL_T, B.x1 + WALL_T, B.z0 - WALL_T / 2, WALL_H, 0.06, WALL_T + 0.06));
  for (const x of [B.x0 + 0.03, B.x1 - 0.03]) trims.push(alongZ(B.z0, B.z1, x, 0, 0.1, 0.06));
  for (const x of [B.x0 - WALL_T / 2, B.x1 + WALL_T / 2]) trims.push(alongZ(B.z0 - WALL_T, B.z1, x, WALL_H, 0.06, WALL_T + 0.06));

  for (const [side, at] of WINDOWS) {
    const W = 1.5;
    const H = 1.3;
    const y = 0.95;
    if (side === 'n') {
      frames.push({ x: at, y, z: B.z0 + 0.04, w: W + 0.12, h: H + 0.12, d: 0.06 });
      windowGlass.push({ x: at, y: y + 0.06, z: B.z0 + 0.075, w: W, h: H, d: 0.02 });
      frames.push({ x: at, y: y + 0.06 + H / 2 - 0.02, z: B.z0 + 0.09, w: W, h: 0.04, d: 0.02 });
      lamps.push({ x: at, y: 2.62, z: B.z0 + 0.1, w: 0.3, h: 0.1, d: 0.18 });
    } else {
      const x = side === 'w' ? B.x0 + 0.04 : B.x1 - 0.04;
      const gx = side === 'w' ? B.x0 + 0.075 : B.x1 - 0.075;
      frames.push({ x, y, z: at, w: 0.06, h: H + 0.12, d: W + 0.12 });
      windowGlass.push({ x: gx, y: y + 0.06, z: at, w: 0.02, h: H, d: W });
      lamps.push({ x: side === 'w' ? B.x0 + 0.1 : B.x1 - 0.1, y: 2.62, z: at, w: 0.18, h: 0.1, d: 0.3 });
    }
  }

  // Vách kính: chân và nẹp đỉnh khung đen, trụ ở hai đầu mỗi đoạn; cạnh chung giữa hai phòng chỉ dựng một lần.
  const seen = new Set<string>();
  for (const room of plan.rooms)
    for (const s of wallSegments(room)) {
      if (isOpenOrOuter(s)) continue;
      const key = `${s.x0},${s.z0},${s.x1},${s.z1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trims.push(segBox(s, 0, 0.1, 0.1), segBox(s, PARTITION_H - 0.04, 0.05, 0.08));
      glass.push(segBox(s, 0.1, PARTITION_H - 0.14, 0.03));
      for (const [x, z] of [
        [s.x0, s.z0],
        [s.x1, s.z1],
      ] as const)
        frames.push({ x, y: 0, z, w: 0.08, h: PARTITION_H, d: 0.08 });
    }
  // Khung cửa: hai trụ cao và thanh ngang.
  for (const room of plan.rooms)
    for (const d of room.doors) {
      const r = room.rect;
      const horizontal = d.side === 'n' || d.side === 's';
      const fixed = d.side === 'n' ? r.z0 : d.side === 's' ? r.z1 : d.side === 'w' ? r.x0 : r.x1;
      const key = `door:${horizontal ? 'h' : 'v'}:${fixed}:${d.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const e of [d.at - DOOR_WIDTH / 2, d.at + DOOR_WIDTH / 2])
        frames.push(horizontal ? { x: e, y: 0, z: fixed, w: 0.1, h: FRAME_H, d: 0.1 } : { x: fixed, y: 0, z: e, w: 0.1, h: FRAME_H, d: 0.1 });
      frames.push(
        horizontal
          ? alongX(d.at - DOOR_WIDTH / 2, d.at + DOOR_WIDTH / 2, fixed, FRAME_H - 0.08, 0.08, 0.1)
          : alongZ(d.at - DOOR_WIDTH / 2, d.at + DOOR_WIDTH / 2, fixed, FRAME_H - 0.08, 0.08, 0.1),
      );
    }
  return { plan, floors, walls, slats, trims, glass, frames, windowGlass, lamps };
}

export function Building({ moduleCount }: { moduleCount: number }) {
  const s = useMemo(() => shell(moduleCount), [moduleCount]);
  return (
    <group>
      <Boxes items={s.floors} roughness={0.9} castShadow={false} />
      <Boxes items={s.walls} color={BUILDING_COLORS.wall} />
      <Boxes items={s.slats} color={BUILDING_COLORS.slat} castShadow={false} />
      <Boxes items={s.trims} color={BUILDING_COLORS.trim} castShadow={false} />
      <Boxes items={s.frames} color={BUILDING_COLORS.frame} roughness={0.5} />
      <Boxes items={s.windowGlass} color={BUILDING_COLORS.window} roughness={0.15} castShadow={false} />
      <Boxes items={s.lamps} color={BUILDING_COLORS.lamp} castShadow={false} />
      <Boxes items={s.glass} color={BUILDING_COLORS.glass} glass castShadow={false} receiveShadow={false} />
      <LightPools rooms={s.plan.rooms} />
      {s.plan.rooms.map((room) => (
        <ZoneSign key={room.id} room={room} />
      ))}
    </group>
  );
}

/**
 * Bảng tên phòng: nền tối, chữ hoa trắng. Hàng bắc treo trên tường bắc; các phòng khác đặt trên vách/khung cửa phía bắc,
 * nhìn về camera.
 */
function ZoneSign({ room }: { room: Room }) {
  const { texture, aspect } = useMemo(() => signTexture(room.label.toUpperCase()), [room.label]);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  const r = room.rect;
  const c = rectCenter(r);
  const onNorthWall = r.z0 === BUILDING.z0;
  const overDoor = room.doors.some((d) => d.side === 'n' && Math.abs(d.at - c.x) < 1e-6);
  const y = onNorthWall ? 2.55 : (overDoor ? FRAME_H : PARTITION_H) + SIGN_H / 2 + 0.03;
  const w = SIGN_H * aspect;
  return (
    <group position={[c.x, y, r.z0 + (onNorthWall ? 0.06 : 0.02)]}>
      <mesh castShadow>
        <boxGeometry args={[w + 0.1, SIGN_H + 0.06, 0.05]} />
        <meshStandardMaterial color={BUILDING_COLORS.signBoard} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.027]}>
        <planeGeometry args={[w, SIGN_H]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function signTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const H = 96;
  const font = `700 ${H * 0.56}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')! as CanvasRenderingContext2D & { letterSpacing: string };
  ctx.font = font;
  ctx.letterSpacing = `${H * 0.05}px`;
  const w = Math.ceil(ctx.measureText(text).width + H * 0.9);
  canvas.width = w;
  canvas.height = H;
  ctx.font = font;
  ctx.letterSpacing = `${H * 0.05}px`;
  ctx.fillStyle = '#f4efe2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, H / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / H };
}

let glowTex: THREE.CanvasTexture | undefined;
/** Gradient tròn mềm dùng chung cho quầng sáng trên sàn. */
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(canvas);
  return glowTex;
}

/** Quầng sáng ấm cộng màu (additive) trên sàn mỗi phòng: không cần đèn động. */
function LightPools({ rooms }: { rooms: Room[] }) {
  const map = useMemo(glowTexture, []);
  return (
    <group>
      {rooms.map(({ id, rect: r }) => {
        const c = rectCenter(r);
        return (
          <mesh key={id} position={[c.x, 0.02, c.z]} rotation-x={-Math.PI / 2} renderOrder={1}>
            <planeGeometry args={[(r.x1 - r.x0) * 1.05, (r.z1 - r.z0) * 1.05]} />
            <meshBasicMaterial map={map} color={BUILDING_COLORS.pool} transparent opacity={id === 'video_studio' ? 0.04 : 0.06} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}
