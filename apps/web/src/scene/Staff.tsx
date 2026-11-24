// Nhân viên cố định không thuộc roster Agent: người pha chế đi lại bên trong quầy bar tròn của Lounge, dừng pha nước cho
// khách ở các điểm phục vụ (office/bartender.ts).

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Appearance } from '../office/appearance.ts';
import { clipFor } from '../office/clips.ts';
import { initialBartender, stepBartender } from '../office/bartender.ts';
import { useKits } from './Agents.tsx';
import { Avatar } from './characterKit.ts';

/** Sơ mi trắng, gi-lê nâu, cà vạt đen. */
const BARTENDER_LOOK: Appearance = {
  model: 'male-a',
  outfit: { top: 'shirt', shirt: '#f4f4f0', sleeves: 'long', pants: '#24262b', shoes: '#24262b', vest: '#7a4a2e', tie: '#24262b' },
  height: 1.02,
  width: 1.0,
};

export function Bartender() {
  const kits = useKits();
  const avatar = useMemo(() => new Avatar(kits[BARTENDER_LOOK.model], 'staff:bartender', true, { appearance: BARTENDER_LOOK, kits }), [kits]);
  useEffect(() => () => avatar.dispose(), [avatar]);
  const walk = useRef(initialBartender());
  useFrame(({ clock }, dt) => {
    const step = Math.min(dt, 0.1);
    const p = stepBartender(walk.current, step);
    // Đi: bước đi; dừng: hai tay pha nước (lắc, rót) quay ra ghế quầy.
    avatar.setPlan(clipFor(p.walking ? 'walk' : 'cards', true));
    avatar.place(p.x, p.z, p.heading);
    avatar.update(step, clock.elapsedTime, 0);
  });
  return <primitive object={avatar.root} />;
}
