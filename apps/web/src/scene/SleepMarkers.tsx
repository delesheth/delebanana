// Chữ "Z z z" nổi lên trên đầu Agent rảnh đang ngồi ở bàn làm việc. Mọi chữ Z của mọi nhân vật vẽ bằng một InstancedMesh;
// geometry, texture và material tạo một lần, mỗi khung chỉ ghi lại ma trận/độ mờ.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { isSnoozing, Z_COUNT, zzzFrame } from '../office/sleep.ts';
import { office, type AgentRuntime } from '../sim/officeStore.ts';

const HEAD_Y = 1.75;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function zTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 108px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 18;
  g.strokeStyle = '#3b4a8c';
  g.strokeText('Z', 64, 68);
  g.fillStyle = '#ffffff';
  g.fillText('Z', 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const tmp = new THREE.Object3D();
const right = new THREE.Vector3();

export function SleepMarkers({ runtimes }: { runtimes: AgentRuntime[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const n = runtimes.length * Z_COUNT;
  const opacity = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(n), 1), [n]);

  const shared = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const map = zTexture();
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
    // Độ mờ riêng từng chữ Z: thuộc tính instance `aOpacity` nhân vào alpha.
    material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOpacity;\nvarying float vZOpacity;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvZOpacity = aOpacity;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vZOpacity;').replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vZOpacity;');
    };
    return { geometry, map, material };
  }, []);
  useEffect(() => () => {
    shared.geometry.dispose();
    shared.map.dispose();
    shared.material.dispose();
  }, [shared]);

  useFrame(({ clock, camera }) => {
    const m = mesh.current;
    if (!m) return;
    m.geometry.setAttribute('aOpacity', opacity);
    const t = clock.elapsedTime;
    const decorative = office.settings.decorative;
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    runtimes.forEach((rt, r) => {
      const on = isSnoozing(rt.animation, rt.arrived, rt.assignment.seat);
      for (let i = 0; i < Z_COUNT; i++) {
        const idx = r * Z_COUNT + i;
        if (!on) {
          m.setMatrixAt(idx, HIDDEN);
          opacity.setX(idx, 0);
          continue;
        }
        const f = zzzFrame(i, decorative ? t : 0.9, rt.phase);
        tmp.position.set(rt.mover.x + right.x * f.dx, HEAD_Y + f.dy, rt.mover.z + right.z * f.dx);
        tmp.quaternion.copy(camera.quaternion);
        tmp.scale.setScalar(f.size);
        opacity.setX(idx, f.opacity);
        tmp.updateMatrix();
        m.setMatrixAt(idx, tmp.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    opacity.needsUpdate = true;
  });

  return <instancedMesh key={n} ref={mesh} args={[shared.geometry, shared.material, n]} frustumCulled={false} renderOrder={5} />;
}
