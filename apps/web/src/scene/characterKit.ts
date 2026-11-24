// Chuẩn bị model Kenney Mini Characters cho hai chế độ dựng.
// Mỗi đỉnh của các model này gắn cứng vào đúng một xương, nên tách được mesh thành bộ phận cứng
// (chân, thân, tay, đầu) để vẽ bằng InstancedMesh mà vẫn dùng chung animation gốc.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Appearance, CharacterModel } from '../office/appearance.ts';
import type { ClipName, ClipPlan, Overlay } from '../office/clips.ts';
import { KIT_SCALE } from './assets.ts';
import { dress, recolorHair } from './outfit.ts';

export interface RigidPart {
  joint: string;
  /** Hình trong hệ toạ độ của xương: ma trận instance = bone.matrixWorld. */
  geometry: THREE.BufferGeometry;
}

export interface CharacterKit {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  parts: RigidPart[];
  material: THREE.Material;
}

const kits = new WeakMap<THREE.Object3D, CharacterKit>();

export function characterKit(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): CharacterKit {
  const cached = kits.get(gltf.scene);
  if (cached) return cached;
  gltf.scene.updateMatrixWorld(true);
  const parts: RigidPart[] = [];
  let material: THREE.Material | undefined;
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.frustumCulled = false;
    material ??= o.material as THREE.Material;
    parts.push(...splitRigid(o));
  });
  const kit: CharacterKit = {
    scene: gltf.scene,
    clips: new Map(gltf.animations.map((c) => [c.name, c])),
    parts,
    material: material!,
  };
  kits.set(gltf.scene, kit);
  return kit;
}

function splitRigid(mesh: THREE.SkinnedMesh): RigidPart[] {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const skinIndex = g.getAttribute('skinIndex');
  const skinWeight = g.getAttribute('skinWeight');
  const index = g.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const vertexAt = (i: number) => (index ? index.getX(i) : i);
  const jointOf = (v: number) => {
    let best = 0;
    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(v, k) > skinWeight.getComponent(v, best)) best = k;
    return skinIndex.getComponent(v, best);
  };

  const byJoint = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const v = vertexAt(t * 3);
    const j = jointOf(v);
    let list = byJoint.get(j);
    if (!list) byJoint.set(j, (list = []));
    list.push(vertexAt(t * 3), vertexAt(t * 3 + 1), vertexAt(t * 3 + 2));
  }

  const out: RigidPart[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const [j, verts] of byJoint) {
    const bone = mesh.skeleton.bones[j]!;
    const toBone = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[j]!, mesh.bindMatrix);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(toBone);
    const positions = new Float32Array(verts.length * 3);
    const normals = new Float32Array(verts.length * 3);
    const uvs = new Float32Array(verts.length * 2);
    verts.forEach((v, i) => {
      p.fromBufferAttribute(pos, v).applyMatrix4(toBone).toArray(positions, i * 3);
      n.fromBufferAttribute(nor, v).applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
      uvs[i * 2] = uv.getX(v);
      uvs[i * 2 + 1] = uv.getY(v);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    out.push({ joint: bone.name, geometry });
  }
  return out;
}

const DIM = new THREE.Color('#9a9a9a');
/** Clip `sit` hạ hông gần sát sàn; nâng cả nhân vật lên cho khớp mặt ghế chairDesk (≈ 0,46 m). */
const SIT_LIFT = 0.4;
const CHAIR_HEIGHT = 0.46;
const WHITE = new THREE.Color('#ffffff');
const OVERLAY_BONES = ['arm-left', 'arm-right', 'head'] as const;

/** Một nhân vật: bản sao model + AnimationMixer. Dùng cho cả hai chế độ dựng. */
export class Avatar {
  readonly root: THREE.Object3D;
  readonly bones = new Map<string, THREE.Object3D>();
  dim = false;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private readonly rest = new Map<string, THREE.Quaternion>();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private current: ClipName | null = null;
  private overlay: Overlay = 'none';

  private readonly kit: CharacterKit;
  private readonly height: number;

  constructor(
    kit: CharacterKit,
    agentId: string,
    /** Chế độ chi tiết cần vật liệu riêng để làm mờ từng nhân vật. */
    ownMaterials: boolean,
    /** Ngoại hình (trang phục, dáng) — chỉ áp ở chế độ chi tiết; chế độ instanced vẽ thân gốc. */
    look?: { appearance: Appearance; kits: Record<CharacterModel, CharacterKit> },
  ) {
    this.kit = kit;
    this.root = cloneSkinned(kit.scene);
    if (look) dress(this.root, look.appearance, look.kits);
    const h = look?.appearance.height ?? 1;
    const w = look?.appearance.width ?? 1;
    this.root.scale.set(KIT_SCALE * w, KIT_SCALE * h, KIT_SCALE * w);
    this.height = h;
    this.root.userData.agentId = agentId;
    this.root.traverse((o) => {
      if (o instanceof THREE.Bone || o.name === 'root') this.bones.set(o.name, o);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        if (ownMaterials) {
          const m = (o.material as THREE.MeshStandardMaterial).clone();
          o.material = m;
          this.materials.push(m);
        }
      }
    });
    if (look?.appearance.outfit?.hair && ownMaterials) recolorHair(this.root, kit, look.appearance.outfit.hair);
    // Tư thế nghỉ = khung đầu của `idle` (tư thế gốc của model là chữ T). Clip không điều khiển
    // xương nào thì xương đó giữ tư thế nghỉ, và lớp chỉnh (overlay) cộng thêm trên nền này.
    const idle = kit.clips.get('idle');
    for (const name of OVERLAY_BONES) {
      const b = this.bones.get(name);
      if (!b) continue;
      const track = idle?.tracks.find((t) => t.name === `${name}.quaternion`);
      this.rest.set(name, track ? new THREE.Quaternion().fromArray(track.values, 0) : b.quaternion.clone());
    }
    this.mixer = new THREE.AnimationMixer(this.root);
  }

  /** `seatHeight`: độ cao mặt ngồi của chỗ hiện tại (ghế bar cao hơn ghế làm việc). */
  setPlan(plan: ClipPlan, seatHeight = CHAIR_HEIGHT) {
    this.overlay = plan.overlay;
    // Clip `sit` hạ hông theo chiều cao nhân vật; nâng lên cho khớp mặt ngồi.
    this.root.position.y = plan.clip === 'sit' ? SIT_LIFT * this.height + (seatHeight - CHAIR_HEIGHT) : 0;
    if (plan.dim !== this.dim) {
      this.dim = plan.dim;
      for (const m of this.materials) m.color.copy(plan.dim ? DIM : WHITE);
    }
    if (plan.clip === this.current) {
      this.actions.get(plan.clip)!.paused = plan.frozen;
      return;
    }
    const next = this.action(plan.clip);
    next.paused = plan.frozen;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().play();
    if (prev) next.crossFadeFrom(prev, 0.25, false);
    this.current = plan.clip;
  }

  place(x: number, z: number, heading: number) {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = heading;
  }

  update(dt: number, t: number, phase: number) {
    for (const [name, q] of this.rest) this.bones.get(name)!.quaternion.copy(q);
    this.mixer.update(dt);
    const s = t + phase;
    const armL = this.bones.get('arm-left');
    const armR = this.bones.get('arm-right');
    const head = this.bones.get('head');
    switch (this.overlay) {
      case 'typing':
        armL?.rotateX(-1.1 + Math.sin(s * 16) * 0.12);
        armR?.rotateX(-1.1 - Math.sin(s * 16) * 0.12);
        head?.rotateX(0.15);
        break;
      case 'reading':
        armL?.rotateX(-0.9);
        armR?.rotateX(-0.9);
        head?.rotateX(0.35 + Math.sin(s * 0.8) * 0.06);
        break;
      case 'scanning':
        head?.rotateY(Math.sin(s * 0.9) * 0.4);
        break;
      case 'tilt':
        head?.rotateZ(0.25);
        break;
      case 'none':
        break;
    }
  }

  /** Dùng lại được sau khi gọi (StrictMode chạy dọn dẹp effect rồi dùng tiếp): action được tạo lại khi cần. */
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
    this.current = null;
    for (const m of this.materials) m.dispose();
  }

  private action(name: ClipName): THREE.AnimationAction {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.kit.clips.get(name) ?? this.kit.clips.get('idle')!;
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }
}
