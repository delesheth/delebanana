// "May đồ" cho nhân vật Kenney: thay thân (body-mesh) bằng thân chuẩn tô màu theo vùng (giày, quần, áo, tay áo, bàn tay),
// và gắn phụ kiện vào xương (cổ áo, nẹp cúc, cà vạt, gi-lê, blazer, thẻ nhân viên, khăn, xích, mũ, kính, tai nghe) nên chúng
// chạy theo animation.
// Toạ độ phụ kiện tính trong không gian model gốc (tư thế chữ T, chưa nhân KIT_SCALE): chân y 0–0,2; thân 0,18–0,36,
// mặt trước z ≈ 0,105; tay duỗi ngang |x| 0,05–0,384; đầu từ y 0,34.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance, CharacterModel, Outfit } from '../office/appearance.ts';
import type { CharacterKit } from './characterKit.ts';

/** Thân áo phông đơn giản làm khuôn may. */
const BASE_BODY: CharacterModel = 'male-f';
const TORSO_FRONT = 0.106;
const TORSO_TOP = 0.357;
const TORSO_BOTTOM = 0.176;

function srgb(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex);
}

function shade(c: THREE.Color, k: number): THREE.Color {
  return c.clone().multiplyScalar(k);
}

// ---------------- Màu da (lấy từ bàn tay của model gốc) ----------------

const pixels = new WeakMap<object, { data: Uint8ClampedArray; w: number; h: number }>();
function sampler(map: THREE.Texture) {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  let px = pixels.get(img);
  if (!px) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    px = { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    pixels.set(img, px);
  }
  const p = px;
  return (u: number, v: number) => {
    const x = Math.min(p.w - 1, Math.max(0, Math.floor(u * p.w)));
    const y = Math.min(p.h - 1, Math.max(0, Math.floor(v * p.h)));
    const i = (y * p.w + x) * 4;
    return new THREE.Color().setRGB(p.data[i]! / 255, p.data[i + 1]! / 255, p.data[i + 2]! / 255, THREE.SRGBColorSpace);
  };
}

function bodyMesh(kit: CharacterKit): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | undefined;
  kit.scene.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh && o.name === 'body-mesh') found = o;
  });
  return found!;
}

const skinCache = new WeakMap<CharacterKit, THREE.Color>();
/** Màu da của model: trung bình màu các đỉnh bàn tay (|x| > 0,345) trên thân gốc. */
export function skinOf(kit: CharacterKit): THREE.Color {
  const cached = skinCache.get(kit);
  if (cached) return cached;
  const mesh = bodyMesh(kit);
  const map = (mesh.material as THREE.MeshStandardMaterial).map!;
  const at = sampler(map);
  const pos = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const sum = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < 0.35) continue;
    sum.add(at(uv.getX(i), uv.getY(i)));
    n++;
  }
  const skin = n ? sum.multiplyScalar(1 / n) : srgb('#e0a57e');
  skinCache.set(kit, skin);
  return skin;
}

// ---------------- Tóc nhuộm ----------------

const hairCache = new WeakMap<CharacterKit, THREE.Color>();
/** Màu tóc gốc của model: texel tại đỉnh cao nhất của đầu. */
function hairOf(kit: CharacterKit): THREE.Color {
  const cached = hairCache.get(kit);
  if (cached) return cached;
  let head: THREE.SkinnedMesh | undefined;
  kit.scene.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh && o.name === 'head-mesh') head = o;
  });
  const map = (head!.material as THREE.MeshStandardMaterial).map!;
  const pos = head!.geometry.getAttribute('position');
  const uv = head!.geometry.getAttribute('uv');
  let top = 0;
  for (let i = 1; i < pos.count; i++) if (pos.getY(i) > pos.getY(top)) top = i;
  const hair = sampler(map)(uv.getX(top), uv.getY(top));
  hairCache.set(kit, hair);
  return hair;
}

/**
 * Nhuộm tóc: thay mọi texel cùng màu tóc gốc trên đầu bằng `color` (sửa shader, giữ nguyên texture dùng chung).
 * Gọi sau khi nhân vật đã có vật liệu riêng.
 */
export function recolorHair(root: THREE.Object3D, kit: CharacterKit, color: string): void {
  const from = hairOf(kit);
  const to = srgb(color);
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh) || o.name !== 'head-mesh') return;
    const m = o.material as THREE.MeshStandardMaterial;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uHairFrom = { value: from };
      shader.uniforms.uHairTo = { value: to };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHairFrom;\nuniform vec3 uHairTo;')
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n#ifdef USE_MAP\nif (distance(sampledDiffuseColor.rgb, uHairFrom) < 0.03) diffuseColor.rgb = uHairTo * diffuse;\n#endif',
        );
    };
    m.customProgramCacheKey = () => `hair:${from.getHexString()}>${to.getHexString()}`;
    m.needsUpdate = true;
  });
}

// ---------------- Thân may theo vùng ----------------

const bodyCache = new Map<string, THREE.BufferGeometry>();

/** Thân chuẩn, bỏ chỉ mục để mỗi tam giác một màu phẳng theo vùng của tâm tam giác. */
export function tailoredBody(kits: Record<CharacterModel, CharacterKit>, head: CharacterModel, o: Outfit): THREE.BufferGeometry {
  const key = `${head}|${JSON.stringify(o)}`;
  const cached = bodyCache.get(key);
  if (cached) return cached;
  const base = bodyMesh(kits[BASE_BODY]);
  const g = base.geometry.toNonIndexed();
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const skinIndex = g.getAttribute('skinIndex');
  const skinWeight = g.getAttribute('skinWeight');
  // Chỉ số xương theo bộ xương của model đầu (thân sẽ gắn vào bản sao của model đó).
  const target = bodyMesh(kits[head]).skeleton.bones.map((b) => b.name);
  const remap = base.skeleton.bones.map((b) => target.indexOf(b.name));
  const jointOf = (v: number) => {
    let best = 0;
    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(v, k) > skinWeight.getComponent(v, best)) best = k;
    return base.skeleton.bones[skinIndex.getComponent(v, best)]!.name;
  };
  const skin = skinOf(kits[head]);
  const shirt = srgb(o.shirt);
  const pants = srgb(o.pants);
  const shoes = srgb(o.shoes);
  const jacket = o.jacket ? srgb(o.jacket) : undefined;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    c.set(0, 0, 0);
    let minY = Infinity;
    let minX = Infinity;
    for (let k = 0; k < 3; k++) {
      c.add(new THREE.Vector3(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k)));
      minY = Math.min(minY, pos.getY(t + k));
      minX = Math.min(minX, Math.abs(pos.getX(t + k)));
    }
    c.multiplyScalar(1 / 3);
    const joint = jointOf(t);
    let col: THREE.Color;
    // Ranh giới vùng theo cạnh thấp nhất / trong nhất của tam giác: hai tam giác của một ô vuông luôn cùng màu.
    if (joint.startsWith('leg')) {
      col = minY < (o.boots ? 0.085 : 0.04) ? shoes : shade(pants, 0.9 + c.y * 0.5);
    } else if (joint.startsWith('arm')) {
      // Tay duỗi ngang ở tư thế gốc: bàn tay, cẳng tay (áo tay ngắn) hoặc tay áo.
      if (minX > 0.335) col = skin;
      else if (jacket) col = minX > 0.315 ? shirt : shade(jacket, 0.95); // tay blazer, cổ tay sơ mi lộ ra
      else if (o.sleeves === 'short' && minX > 0.225) col = skin;
      else col = shade(shirt, 0.92);
    } else {
      col = shade(shirt, 0.9 + ((c.y - TORSO_BOTTOM) / (TORSO_TOP - TORSO_BOTTOM)) * 0.12);
    }
    for (let k = 0; k < 3; k++) col.toArray(colors, (t + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (remap.some((to, from) => to !== from)) {
    for (let v = 0; v < skinIndex.count; v++)
      for (let k = 0; k < 4; k++) skinIndex.setComponent(v, k, Math.max(0, remap[skinIndex.getComponent(v, k)]!));
  }
  bodyCache.set(key, g);
  return g;
}

// ---------------- Phụ kiện ----------------

interface Piece {
  bone: 'torso' | 'head';
  geometry: THREE.BufferGeometry;
  color: string;
  /** Vị trí, góc Euler, tỉ lệ trong không gian model. */
  p: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  dome: new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  ring: new THREE.TorusGeometry(0.5, 0.09, 6, 24),
  chain: new THREE.TorusGeometry(0.5, 0.06, 6, 32, Math.PI),
  band: new THREE.TorusGeometry(0.5, 0.05, 6, 24, Math.PI),
};

const box = (bone: Piece['bone'], color: string, p: Piece['p'], s: Piece['s'], r?: Piece['r']): Piece => ({ bone, geometry: G.box, color, p, s, r });

const headBox = new WeakMap<CharacterKit, THREE.Box3>();
function headBounds(kit: CharacterKit): THREE.Box3 {
  let b = headBox.get(kit);
  if (!b) {
    b = new THREE.Box3();
    kit.scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh && o.name === 'head-mesh') {
        o.geometry.computeBoundingBox();
        b!.union(o.geometry.boundingBox!);
      }
    });
    headBox.set(kit, b);
  }
  return b;
}

function pieces(o: Outfit, head: THREE.Box3): Piece[] {
  const z = TORSO_FRONT;
  const collar = o.collar ?? o.shirt;
  const out: Piece[] = [];
  // Cổ áo bẻ hai bên và dải cổ sau.
  for (const s of [-1, 1]) out.push(box('torso', collar, [s * 0.05, TORSO_TOP - 0.012, z + 0.006], [0.085, 0.05, 0.02], [-0.25, 0, s * 0.5]));
  out.push(box('torso', collar, [0, TORSO_TOP - 0.004, -0.02], [0.24, 0.035, 0.24]));
  const placket = new THREE.Color().setStyle(o.shirt).multiplyScalar(0.8).getStyle();
  if (o.top === 'polo') {
    out.push(box('torso', placket, [0, TORSO_TOP - 0.05, z + 0.002], [0.032, 0.07, 0.006]));
    for (const y of [0.32, 0.297]) out.push(box('torso', '#f2f2ee', [0, y, z + 0.006], [0.012, 0.012, 0.004]));
  } else {
    out.push(box('torso', placket, [0, 0.265, z + 0.002], [0.022, 0.16, 0.006]));
    for (const y of [0.31, 0.27, 0.23]) out.push(box('torso', '#f2f2ee', [0, y, z + 0.006], [0.011, 0.011, 0.004]));
    out.push(box('torso', placket, [0.075, 0.3, z + 0.002], [0.05, 0.05, 0.006]));
  }
  if (o.tie) {
    out.push(box('torso', o.tie, [0, TORSO_TOP - 0.02, z + 0.01], [0.04, 0.03, 0.012]));
    out.push(box('torso', o.tie, [0, 0.27, z + 0.01], [0.042, 0.13, 0.008]));
  }
  if (o.vest) {
    for (const s of [-1, 1]) out.push(box('torso', o.vest, [s * 0.088, 0.262, z + 0.006], [0.115, 0.16, 0.012]));
    out.push(box('torso', o.vest, [0, 0.262, -0.168], [0.3, 0.16, 0.012]));
    for (const s of [-1, 1]) out.push(box('torso', o.vest, [s * 0.155, 0.262, -0.03], [0.012, 0.16, 0.27]));
  }
  if (o.jacket) {
    // Blazer: hai vạt trước chừa khe giữa cho sơ mi/cà vạt, lưng và hông, ve áo chéo, một cúc.
    const j = o.jacket;
    const lapel = new THREE.Color().setStyle(j).multiplyScalar(0.78).getStyle();
    const cy = (TORSO_BOTTOM - 0.012 + TORSO_TOP - 0.004) / 2;
    const h = TORSO_TOP - 0.004 - (TORSO_BOTTOM - 0.012);
    for (const s of [-1, 1]) out.push(box('torso', j, [s * 0.09, cy, z + 0.008], [0.12, h, 0.014]));
    out.push(box('torso', j, [0, cy, -0.172], [0.32, h, 0.014]));
    for (const s of [-1, 1]) out.push(box('torso', j, [s * 0.16, cy, -0.03], [0.014, h, 0.29]));
    for (const s of [-1, 1]) out.push(box('torso', lapel, [s * 0.046, 0.305, z + 0.017], [0.032, 0.1, 0.006], [0, 0, -s * 0.38]));
    out.push(box('torso', '#1a1a1a', [0.04, 0.215, z + 0.017], [0.014, 0.014, 0.004]));
  }
  if (o.badge) {
    // Thẻ nhân viên: hai dây từ cổ chụm xuống thẻ trắng có dải màu.
    const bz = z + (o.jacket ? 0.022 : 0.016);
    for (const s of [-1, 1]) out.push(box('torso', o.badge, [s * 0.0225, 0.31, bz], [0.008, 0.088, 0.004], [0, 0, -s * 0.54]));
    out.push(box('torso', '#f7f7f4', [0, 0.235, bz], [0.05, 0.065, 0.006]));
    out.push(box('torso', o.badge, [0, 0.259, bz + 0.001], [0.05, 0.016, 0.006]));
    out.push(box('torso', '#9aa0a8', [0, 0.226, bz + 0.002], [0.026, 0.026, 0.004]));
  }
  if (o.bandana) out.push(box('torso', o.bandana, [0, TORSO_TOP - 0.035, z + 0.012], [0.07, 0.07, 0.01], [0, 0, Math.PI / 4]));
  if (o.chain) {
    out.push({ bone: 'torso', geometry: G.chain, color: '#f2c14e', p: [0, TORSO_TOP - 0.005, z + 0.004], r: [0, 0, Math.PI], s: [0.17, 0.17, 0.17] });
    out.push(box('torso', '#f2c14e', [0, 0.26, z + 0.01], [0.04, 0.04, 0.01]));
  }
  if (o.boots) out.push(box('torso', '#d4a83a', [0, TORSO_BOTTOM + 0.014, z + 0.004], [0.055, 0.035, 0.008]));

  // Phụ kiện trên đầu, canh theo khung của đầu.
  const top = head.max.y;
  const cz = (head.min.z + head.max.z) / 2;
  const front = head.max.z;
  const eyeY = head.min.y + (top - head.min.y) * 0.42;
  const hat = o.hat;
  if (hat?.kind === 'cowboy') {
    out.push({ bone: 'head', geometry: G.cyl, color: hat.color, p: [0, top - 0.02, cz], s: [0.66, 0.02, 0.6], r: [0.08, 0, 0] });
    out.push({ bone: 'head', geometry: G.cyl, color: hat.color, p: [0, top + 0.06, cz], s: [0.36, 0.15, 0.32], r: [0.08, 0, 0] });
    out.push({ bone: 'head', geometry: G.cyl, color: '#3b2516', p: [0, top + 0.005, cz], s: [0.365, 0.03, 0.325], r: [0.08, 0, 0] });
  } else if (hat?.kind === 'cap') {
    // Mũ lưỡi trai: chóp ôm đỉnh đầu, lưỡi trai cứng chìa ra trước, nút trên đỉnh.
    out.push({ bone: 'head', geometry: G.dome, color: hat.color, p: [0, top - 0.09, cz - 0.01], s: [0.44, 0.3, 0.4] });
    out.push(box('head', hat.color, [0, top - 0.095, cz - 0.01], [0.44, 0.03, 0.4]));
    out.push(box('head', hat.brim ?? hat.color, [0, top - 0.1, front + 0.07], [0.3, 0.022, 0.2], [0.18, 0, 0]));
    out.push(box('head', '#f2f2ee', [0, top + 0.035, cz - 0.01], [0.035, 0.02, 0.035]));
  }
  if (o.glasses) {
    for (const s of [-1, 1]) out.push({ bone: 'head', geometry: G.ring, color: o.glasses, p: [s * 0.085, eyeY, front + 0.004], s: [0.09, 0.09, 0.09] });
    out.push(box('head', o.glasses, [0, eyeY, front + 0.004], [0.06, 0.012, 0.01]));
  }
  if (o.headset) {
    out.push({ bone: 'head', geometry: G.band, color: o.headset, p: [0, eyeY, cz], s: [0.5, 0.5 * ((top - eyeY + 0.02) / 0.25), 0.5] });
    for (const s of [-1, 1]) out.push({ bone: 'head', geometry: G.cyl, color: o.headset, p: [s * 0.245, eyeY, cz], r: [0, 0, Math.PI / 2], s: [0.12, 0.05, 0.12] });
  }
  return out;
}

/**
 * Mặc đồ cho bản sao nhân vật: thay thân bằng thân may, gắn phụ kiện vào xương, đặt dáng (cao/ngang). Gọi trước khi chạy
 * animation (bản sao còn ở tư thế gốc). Trả về `false` khi giữ nguyên thân gốc (Giám đốc).
 */
export function dress(root: THREE.Object3D, appearance: Appearance, kits: Record<CharacterModel, CharacterKit>): boolean {
  const o = appearance.outfit;
  if (!o) return false;
  let body: THREE.SkinnedMesh | undefined;
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((n) => {
    if (n instanceof THREE.SkinnedMesh && n.name === 'body-mesh') body = n;
    if (n instanceof THREE.Bone) bones.set(n.name, n);
  });
  if (!body) return false;
  body.geometry = tailoredBody(kits, appearance.model, o);
  body.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

  root.updateMatrixWorld(true);
  const rootM = root.matrixWorld;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  // Gộp mọi phụ kiện của một xương thành một mesh màu theo đỉnh (một draw call mỗi xương).
  const byBone = new Map<Piece['bone'], THREE.BufferGeometry[]>();
  for (const pc of pieces(o, headBounds(kits[appearance.model]))) {
    const bone = bones.get(pc.bone);
    if (!bone) continue;
    m.compose(new THREE.Vector3(...pc.p), q.setFromEuler(e.set(...(pc.r ?? [0, 0, 0]))), new THREE.Vector3(...(pc.s ?? [1, 1, 1])));
    // Từ không gian model sang không gian xương ở tư thế gốc.
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(rootM).multiply(m);
    const g = pc.geometry.clone().applyMatrix4(local);
    const col = srgb(pc.color);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) col.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    byBone.set(pc.bone, [...(byBone.get(pc.bone) ?? []), g]);
  }
  for (const [name, list] of byBone) {
    const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    mesh.castShadow = true;
    bones.get(name)!.add(mesh);
  }
  return true;
}
