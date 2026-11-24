// Vẽ nhiều bản của một model nội thất Kenney bằng InstancedMesh (mỗi vật liệu một draw call).

import { useGLTF } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { KIT_SCALE, furnitureUrl, type FurnitureName } from './assets.ts';

export interface Placement {
  x: number;
  z: number;
  y?: number;
  /** Góc quay quanh trục Y (rad). */
  rotY?: number;
  /** Nhân thêm với KIT_SCALE; số đơn hoặc [x, y, z]. */
  scale?: number | [number, number, number];
  /** Nhuộm màu (nhân với màu vật liệu). */
  tint?: string;
}

interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const partsCache = new WeakMap<THREE.Object3D, KitPart[]>();

/**
 * Gộp mọi mesh của model thành các phần theo vật liệu, đã nhân KIT_SCALE và dời về
 * tâm đáy (x, z ở giữa, y = 0) để đặt theo toạ độ tâm.
 */
function kitParts(scene: THREE.Object3D): KitPart[] {
  const cached = partsCache.get(scene);
  if (cached) return cached;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const toBase = new THREE.Matrix4()
    .makeScale(KIT_SCALE, KIT_SCALE, KIT_SCALE)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const parts: KitPart[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toBase, o.matrixWorld));
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.length === 1 || geometry.groups.length === 0) {
      parts.push({ geometry, material: materials[0]! });
      return;
    }
    // Mesh nhiều vật liệu: tách theo group.
    for (const group of geometry.groups) {
      const part = geometry.clone();
      part.clearGroups();
      part.setDrawRange(group.start, group.count);
      parts.push({ geometry: part, material: materials[group.materialIndex ?? 0]! });
    }
  });
  partsCache.set(scene, parts);
  return parts;
}

const tmp = new THREE.Object3D();
const color = new THREE.Color();

export function KitInstances({
  name,
  items,
  castShadow = true,
  receiveShadow = true,
}: {
  name: FurnitureName;
  items: Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const { scene } = useGLTF(furnitureUrl(name));
  const parts = useMemo(() => kitParts(scene), [scene]);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);

  useLayoutEffect(() => {
    for (const mesh of refs.current) {
      if (!mesh) continue;
      items.forEach((it, i) => {
        tmp.position.set(it.x, it.y ?? 0, it.z);
        tmp.rotation.set(0, it.rotY ?? 0, 0);
        if (Array.isArray(it.scale)) tmp.scale.set(...it.scale);
        else tmp.scale.setScalar(it.scale ?? 1);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        if (it.tint) mesh.setColorAt(i, color.set(it.tint));
        else if (mesh.instanceColor) mesh.setColorAt(i, color.set('#ffffff'));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [items, parts]);

  if (items.length === 0) return null;
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={`${i}:${items.length}`}
          ref={(m) => {
            refs.current[i] = m;
          }}
          args={[p.geometry, p.material, items.length]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      ))}
    </>
  );
}
