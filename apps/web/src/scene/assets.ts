// Asset 3D: Kenney Mini Characters 2.0 và Furniture Kit 2.0 (CC0, www.kenney.nl).
// Tệp nằm trong public/models; giấy phép kèm theo ở từng thư mục.

import { useGLTF } from '@react-three/drei';
import { CHARACTER_MODELS, type CharacterModel } from '../office/appearance.ts';
import type { KenneyModel } from '../office/plan.ts';

/** Hệ số phóng to chung cho mọi asset Kenney (1 ô tường của kit = 2,4 m trong văn phòng). */
export const KIT_SCALE = 2.4;


/** Model Kenney còn dùng (cây lớn); mọi nội thất khác dựng bằng khối (Furniture.tsx). */
export const FURNITURE = ['pottedPlant'] as const satisfies readonly KenneyModel[];
export type FurnitureName = (typeof FURNITURE)[number];

const base = import.meta.env.BASE_URL;
export const characterUrl = (m: CharacterModel) => `${base}models/characters/character-${m}.glb`;
export const furnitureUrl = (f: FurnitureName) => `${base}models/furniture/${f}.glb`;

export function preloadAssets() {
  for (const m of CHARACTER_MODELS) useGLTF.preload(characterUrl(m));
  for (const f of FURNITURE) useGLTF.preload(furnitureUrl(f));
}
