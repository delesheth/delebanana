// Nhân vật Agent (Kenney Mini Characters). Hai cách vẽ cùng một Avatar/AnimationMixer để so sánh hiệu năng:
// - Chi tiết: mỗi nhân vật là SkinnedMesh riêng (≈ 2 draw call/nhân vật).
// - Instanced: bộ phận cứng tách theo xương, mỗi (model, bộ phận) một InstancedMesh (gộp, D-5).

import { useGLTF } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CHARACTER_MODELS, type CharacterModel } from '../office/appearance.ts';
import { atSeat, clipFor } from '../office/clips.ts';
import { office, type AgentRuntime } from '../sim/officeStore.ts';
import { characterUrl } from './assets.ts';
import { Avatar, characterKit, type CharacterKit } from './characterKit.ts';
import { ICON_COLORS, ZONE_COLORS } from './palette.ts';

export function useKits(): Record<CharacterModel, CharacterKit> {
  const gltfs = useGLTF(CHARACTER_MODELS.map(characterUrl));
  return useMemo(
    () => Object.fromEntries(CHARACTER_MODELS.map((m, i) => [m, characterKit(gltfs[i]!)])) as Record<CharacterModel, CharacterKit>,
    [gltfs],
  );
}

function select(e: ThreeEvent<MouseEvent>, id: string) {
  e.stopPropagation();
  office.select(id);
}

interface Entry {
  rt: AgentRuntime;
  avatar: Avatar;
}

/** Cập nhật animation và vị trí mọi Avatar mỗi khung hình. */
function useAvatarDriver(entries: Entry[]) {
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const decorative = office.settings.decorative;
    for (const { rt, avatar } of entries) {
      avatar.setPlan(
        rt.arrived ? atSeat(clipFor(rt.animation, decorative), rt.assignment.seat.posture) : clipFor('walk', decorative),
        rt.arrived ? rt.assignment.seat.seatHeight : undefined,
      );
      avatar.place(rt.mover.x, rt.mover.z, rt.mover.heading);
      avatar.update(Math.min(dt, 0.1), t, rt.phase);
    }
  });
}

function useAvatars(runtimes: AgentRuntime[], kits: Record<CharacterModel, CharacterKit>, ownMaterials: boolean): Entry[] {
  const entries = useMemo(
    () =>
      runtimes.map((rt) => ({
        rt,
        avatar: new Avatar(kits[rt.profile.appearance.model], rt.profile.id, ownMaterials, ownMaterials ? { appearance: rt.profile.appearance, kits } : undefined),
      })),
    [runtimes, kits, ownMaterials],
  );
  useEffect(() => () => entries.forEach((e) => e.avatar.dispose()), [entries]);
  return entries;
}

// ---------------- Chế độ chi tiết ----------------

export function DetailedAgents({ runtimes }: { runtimes: AgentRuntime[] }) {
  const kits = useKits();
  const entries = useAvatars(runtimes, kits, true);
  useAvatarDriver(entries);
  return (
    <group>
      {entries.map(({ rt, avatar }) => (
        <primitive key={rt.profile.id} object={avatar.root} onClick={(e: ThreeEvent<MouseEvent>) => select(e, rt.profile.id)} />
      ))}
    </group>
  );
}

// ---------------- Chế độ instanced ----------------

const DIM = new THREE.Color('#9a9a9a');
const WHITE = new THREE.Color('#ffffff');

function ModelInstances({ kit, entries }: { kit: CharacterKit; entries: Entry[] }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const lastBounds = useRef(0);

  useFrame(({ clock }) => {
    entries.forEach(({ avatar }, i) => {
      avatar.root.updateMatrixWorld(true);
      kit.parts.forEach((part, p) => {
        const mesh = meshes.current[p];
        if (!mesh) return;
        mesh.setMatrixAt(i, avatar.bones.get(part.joint)!.matrixWorld);
        mesh.setColorAt(i, avatar.dim ? DIM : WHITE);
      });
    });
    const refresh = clock.elapsedTime - lastBounds.current > 0.5;
    if (refresh) lastBounds.current = clock.elapsedTime;
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Bounding sphere dùng cho raycast khi click; nhân vật di chuyển nên làm mới định kỳ.
      if (refresh) mesh.computeBoundingSphere();
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const entry = e.instanceId !== undefined ? entries[e.instanceId] : undefined;
    if (entry) select(e, entry.rt.profile.id);
  };

  return (
    <>
      {kit.parts.map((part, p) => (
        <instancedMesh
          key={`${part.joint}:${p}:${entries.length}`}
          ref={(m) => {
            meshes.current[p] = m;
          }}
          args={[part.geometry, kit.material, entries.length]}
          castShadow
          frustumCulled={false}
          onClick={onClick}
        />
      ))}
    </>
  );
}

export function InstancedAgents({ runtimes }: { runtimes: AgentRuntime[] }) {
  const kits = useKits();
  const entries = useAvatars(runtimes, kits, false);
  useAvatarDriver(entries);
  const byModel = useMemo(() => {
    const groups = new Map<CharacterModel, Entry[]>();
    for (const e of entries) {
      const m = e.rt.profile.appearance.model;
      groups.set(m, [...(groups.get(m) ?? []), e]);
    }
    return [...groups];
  }, [entries]);
  return (
    <group>
      {byModel.map(([model, list]) => (
        <ModelInstances key={model} kit={kits[model]} entries={list} />
      ))}
    </group>
  );
}

// ---------------- Biểu tượng trạng thái, nhãn phòng ban, vòng chọn ----------------

const tmp = new THREE.Object3D();
const color = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Bong bóng trạng thái trên đầu và vòng màu phòng ban dưới chân (khi ngồi tạm vì phòng đầy). Luôn instanced. */
export function StatusMarkers({ runtimes }: { runtimes: AgentRuntime[] }) {
  const icons = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const decorative = office.settings.decorative;
    runtimes.forEach((rt, i) => {
      if (icons.current) {
        if (rt.icon === 'none') icons.current.setMatrixAt(i, HIDDEN);
        else {
          const bob = decorative ? Math.sin(t * 3 + rt.phase) * 0.08 : 0;
          tmp.position.set(rt.mover.x, 2.15 + bob, rt.mover.z);
          tmp.rotation.set(0, t * 1.5, 0);
          tmp.scale.setScalar(1);
          tmp.updateMatrix();
          icons.current.setMatrixAt(i, tmp.matrix);
          icons.current.setColorAt(i, color.set(ICON_COLORS[rt.icon]));
        }
      }
      if (rings.current) {
        const dept = rt.assignment.overflowFrom;
        if (!dept) rings.current.setMatrixAt(i, HIDDEN);
        else {
          tmp.position.set(rt.mover.x, 0.07, rt.mover.z);
          tmp.rotation.set(-Math.PI / 2, 0, 0);
          tmp.scale.setScalar(1);
          tmp.updateMatrix();
          rings.current.setMatrixAt(i, tmp.matrix);
          rings.current.setColorAt(i, color.set(ZONE_COLORS[dept]));
        }
      }
    });
    for (const m of [icons.current, rings.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });
  const n = runtimes.length;
  return (
    <group>
      <instancedMesh key={`icon${n}`} ref={icons} args={[undefined, undefined, n]} frustumCulled={false}>
        <octahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial emissive="#ffffff" emissiveIntensity={0.25} flatShading />
      </instancedMesh>
      <instancedMesh key={`ring${n}`} ref={rings} args={[undefined, undefined, n]} frustumCulled={false}>
        <ringGeometry args={[0.55, 0.75, 24]} />
        <meshBasicMaterial />
      </instancedMesh>
    </group>
  );
}

export function SelectionRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rt = office.selectedId ? office.runtime(office.selectedId) : undefined;
    mesh.visible = rt !== undefined;
    if (rt) mesh.position.set(rt.mover.x, 0.08, rt.mover.z);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.8, 0.95, 32]} />
      <meshBasicMaterial color="#ff4d6d" />
    </mesh>
  );
}
