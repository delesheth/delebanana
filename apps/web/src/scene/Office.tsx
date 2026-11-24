import { MapControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useRef, useSyncExternalStore } from 'react';
import { Color, FogExp2, Vector3 } from 'three';
import type * as THREE from 'three';
import { office } from '../sim/officeStore.ts';
import { AgentChipProjector } from '../ui/AgentChips.tsx';
import { DetailedAgents, InstancedAgents, SelectionRing, StatusMarkers } from './Agents.tsx';
import { SleepMarkers } from './SleepMarkers.tsx';
import { preloadAssets } from './assets.ts';
import { extentFor, roomById } from '../office/plan.ts';
import { cameraFocus, type CameraFocus } from '../sim/cameraFocus.ts';
import { Building } from './Building.tsx';
import { Furniture } from './Furniture.tsx';
import { Bartender } from './Staff.tsx';
import { BUILDING_COLORS } from './palette.ts';

preloadAssets();

/** `?zoom=` phóng gần hơn so với khung vừa cả văn phòng (tiện chụp so sánh). */
const INITIAL_ZOOM = Number(new URLSearchParams(location.search).get('zoom')) || 1;
/** `?at=x,z` đặt tâm khung hình ban đầu (tiện chụp từng phòng). */
const INITIAL_AT = new URLSearchParams(location.search).get('at')?.split(',').map(Number);
/** Camera phối cảnh nhìn từ phía nam, nghiêng xuống PITCH độ; trục x của văn phòng nằm ngang màn hình. */
const FOV = 38;
const PITCH = 40;
/** Camera nhắm vào ngang ngực nhân vật. */
const AIM_Y = 0.9;
/** Mật độ sương nhân khoảng cách camera lúc vừa khung. */
const FOG_AT_FIT = 0.22;

/**
 * Khoảng cách camera để cả mặt sàn (và tường bắc) vừa khung hình. Chiều ngang tính theo mép sàn gần camera nhất
 * (phối cảnh làm mép gần to hơn mép xa).
 */
function fitDistance(aspect: number, w: number, d: number): number {
  const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
  const pitch = (PITCH * Math.PI) / 180;
  const byWidth = w / 2 / (tanHalf * aspect) + (d / 2) * Math.cos(pitch);
  const byDepth = ((d / 2 + 1.5) * Math.sin(pitch)) / tanHalf;
  return Math.max(byWidth, byDepth) * 1.02;
}

/** Khung cần nhìn: toàn văn phòng hoặc một phòng (thêm lề để thấy cả tường và cửa). */
function viewFor(focus: CameraFocus, moduleCount: number) {
  if (focus === 'all') {
    const ext = extentFor(moduleCount);
    return {
      cx: INITIAL_AT?.[0] ?? (ext.x0 + ext.x1) / 2,
      cz: INITIAL_AT?.[1] ?? (ext.z0 + ext.z1) / 2,
      w: ext.x1 - ext.x0 + 1,
      d: ext.z1 - ext.z0,
      zoom: INITIAL_ZOOM,
    };
  }
  const r = roomById(focus, moduleCount).rect;
  return { cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, w: (r.x1 - r.x0) * 1.2 + 2, d: (r.z1 - r.z0) * 1.2 + 2, zoom: 1 };
}

const FLY_SECONDS = 0.8;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Canh camera theo `cameraFocus` (mặc định cả tòa nhà vừa màn hình). Canh lại khi khung 3D đổi kích thước (sidebar co
 * giãn) cho tới khi người dùng tự kéo/zoom; bấm nút trên Dock thì bay mượt tới khu đó.
 */
function CameraRig() {
  const fitted = useRef('');
  const userMoved = useRef(false);
  const lastSeq = useRef(-1);
  const fly = useRef<{ fromP: THREE.Vector3; fromT: THREE.Vector3; toP: THREE.Vector3; toT: THREE.Vector3; t: number } | null>(null);
  // Canh ở khung hình (MapControls đã khởi tạo; trong layout effect nó còn ghi đè target).
  useFrame(({ camera, size, controls, scene }, dt) => {
    const c = controls as (THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; maxDistance: number; update(): void }) | null;
    if (!c || size.width === 0) return;
    if (!fitted.current)
      c.addEventListener('start', () => {
        userMoved.current = true;
        fly.current = null;
      });
    const { focus, seq } = cameraFocus.get();
    if (seq !== lastSeq.current) userMoved.current = false;
    const key = `${size.width}x${size.height}:${office.moduleCount}:${seq}`;
    if (!userMoved.current && fitted.current !== key) {
      const aspect = size.width / size.height;
      // Giới hạn lùi xa và sương luôn tính theo khung toàn cảnh.
      const all = viewFor('all', office.moduleCount);
      const allDist = fitDistance(aspect, all.w, all.d);
      c.maxDistance = Math.max(70, allDist * 1.25);
      if (scene.fog instanceof FogExp2) scene.fog.density = FOG_AT_FIT / allDist;
      const v = viewFor(focus, office.moduleCount);
      const dist = fitDistance(aspect, v.w, v.d) / v.zoom;
      const p = (PITCH * Math.PI) / 180;
      const toP = new Vector3(v.cx, AIM_Y + dist * Math.sin(p), v.cz + dist * Math.cos(p));
      const toT = new Vector3(v.cx, AIM_Y, v.cz);
      if (seq !== lastSeq.current && fitted.current) {
        fly.current = { fromP: camera.position.clone(), fromT: c.target.clone(), toP, toT, t: 0 };
      } else if (fly.current) {
        // Đang bay mà khung đổi kích thước: đổi đích, bay tiếp.
        fly.current.toP = toP;
        fly.current.toT = toT;
      } else {
        camera.position.copy(toP);
        c.target.copy(toT);
        c.update();
      }
      fitted.current = key;
      lastSeq.current = seq;
    }
    const f = fly.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLY_SECONDS);
      const k = ease(f.t);
      camera.position.lerpVectors(f.fromP, f.toP, k);
      c.target.lerpVectors(f.fromT, f.toT, k);
      c.update();
      if (f.t >= 1) fly.current = null;
    }
  });
  return null;
}

const DAY_BG = new Color(BUILDING_COLORS.background);
const NIGHT_BG = new Color('#1b2030');
const LIGHT_FADE = 2.2;

/** Đèn văn phòng: tắt khi server dừng (chỉ còn ánh trăng xanh mờ), bật lại mượt khi server chạy. */
function Lighting({ shadows }: { shadows: boolean }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.AmbientLight>(null);
  const level = useRef(office.lightsOn() ? 1 : 0);
  useFrame(({ scene }, dt) => {
    const target = office.lightsOn() ? 1 : 0;
    const l = (level.current += Math.sign(target - level.current) * Math.min(Math.abs(target - level.current), dt * LIGHT_FADE));
    if (hemi.current) hemi.current.intensity = 0.08 + 0.92 * l;
    if (sun.current) sun.current.intensity = 1.7 * l;
    if (moon.current) moon.current.intensity = 0.35 * (1 - l);
    if (scene.background instanceof Color) scene.background.lerpColors(NIGHT_BG, DAY_BG, l);
    if (scene.fog) scene.fog.color.lerpColors(NIGHT_BG, DAY_BG, l);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#ffffff', '#d9cfc0', 1.0]} />
      <ambientLight ref={moon} color="#6f86c9" intensity={0} />
      <directionalLight
        ref={sun}
        position={[-20, 26, 12]}
        intensity={1.7}
        color="#fff4e4"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={90}
      />
    </>
  );
}

/** Cập nhật mô phỏng + di chuyển, và đo FPS/draw call (đầu ra của spike S4). */
function FrameLoop() {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame(({ gl }, dt) => {
    office.update(Math.min(dt, 0.1));
    const a = acc.current;
    a.frames++;
    a.time += dt;
    if (a.time >= 0.5) {
      // gl.info đếm theo khung vừa vẽ (tự reset mỗi lần render).
      office.setMetrics({
        frames: a.frames,
        seconds: a.time,
        fps: a.frames / a.time,
        frameMs: (a.time / a.frames) * 1000,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

export function Office() {
  const ui = useSyncExternalStore(office.subscribeUi, office.getUi);
  const mode = office.effectiveMode();
  const runtimes = office.runtimes;
  const { shadows } = ui.settings;
  // Đèn tắt (server dừng): văn phòng không có ai, kể cả bartender.

  return (
    <Canvas shadows={shadows ? 'percentage' : false} dpr={[1, 2]} onPointerMissed={() => office.select(null)}>
      <color attach="background" args={[BUILDING_COLORS.background]} />
      <fogExp2 attach="fog" args={[BUILDING_COLORS.background, 0.006]} />
      <PerspectiveCamera makeDefault fov={FOV} near={0.5} far={300} />
      <MapControls makeDefault enableRotate={false} screenSpacePanning={false} minDistance={6} maxDistance={70} />
      <CameraRig />
      <Lighting shadows={shadows} />
      <FrameLoop />
      <Suspense fallback={null}>
        <Building moduleCount={office.moduleCount} />
        {ui.lightsOn && <Bartender />}
        <Furniture moduleCount={office.moduleCount} />
        {ui.lightsOn && (mode === 'detailed' ? <DetailedAgents runtimes={runtimes} /> : <InstancedAgents runtimes={runtimes} />)}
      </Suspense>
      {ui.lightsOn && <StatusMarkers runtimes={runtimes} />}
      {ui.lightsOn && <SleepMarkers runtimes={runtimes} />}
      {ui.lightsOn && <SelectionRing />}
      <AgentChipProjector />
    </Canvas>
  );
}
