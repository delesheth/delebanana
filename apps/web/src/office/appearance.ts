// Ngoại hình nhân vật. Sau này lưu trong Agent Registry (M2); spike chọn tất định theo thứ tự trong roster.
// Đầu (mặt, tóc) lấy từ Kenney Mini Characters; thân được "may" lại theo `Outfit` (scene/outfit.ts): Giám đốc mặc vest,
// nhân viên mặc đồ công sở (sơ mi, quần âu, cà vạt, blazer, thẻ nhân viên), mỗi người một bộ, một dáng.

/** Nhân vật trong Kenney Mini Characters (public/models/characters/character-<model>.glb). */
export const CHARACTER_MODELS = [
  'male-a',
  'male-b',
  'male-c',
  'male-d',
  'male-e',
  'male-f',
  'male-g',
  'female-a',
  'female-b',
  'female-c',
  'female-d',
  'female-e',
  'female-f',
] as const;
export type CharacterModel = (typeof CHARACTER_MODELS)[number];

/** Model mặc vest đen, cà vạt đỏ: dùng nguyên cho Giám đốc. */
export const DIRECTOR_MODEL: CharacterModel = 'male-d';

export interface Outfit {
  top: 'polo' | 'shirt';
  shirt: string;
  sleeves: 'long' | 'short';
  pants: string;
  shoes: string;
  /** Màu cổ áo (mặc định trùng màu áo). */
  collar?: string;
  tie?: string;
  /** Áo gi-lê (cowboy, công sở). */
  vest?: string;
  /** Áo blazer: hai vạt trước, lưng, tay áo cùng màu, ve áo; cổ tay sơ mi lộ ra. */
  jacket?: string;
  /** Thẻ nhân viên đeo cổ: màu dây. */
  badge?: string;
  /** Tóc nhuộm (thay màu tóc gốc của đầu). */
  hair?: string;
  bandana?: string;
  hat?: { kind: 'cowboy' | 'cap'; color: string; brim?: string };
  glasses?: string;
  headset?: string;
  chain?: boolean;
  /** Ủng cao (cowboy). */
  boots?: boolean;
}

export interface Appearance {
  /** Đầu (mặt, tóc). */
  model: CharacterModel;
  /** `undefined` = giữ nguyên thân của model (Giám đốc). */
  outfit?: Outfit;
  /** Dáng: hệ số chiều cao và bề ngang. */
  height: number;
  width: number;
}

const black = '#24262b';
const white = '#f2f2ee';
const khaki = '#c8b48a';
const navy = '#2b3a55';
const charcoal = '#3a3d44';
const grey = '#6b7380';
const brown = '#5a3a22';
const darkBrown = '#3e2a1c';
const skyBlue = '#cfe3f7';
const paleBlue = '#a9c8e8';
const pink = '#f3d3da';
const lavender = '#d9d0ec';
const silver = '#dcdde0';
const mint = '#d5eadf';
const cream = '#f2ead8';
const burgundy = '#7b2d3b';
const forest = '#2e5d4b';
const red = '#b03a2e';
const plum = '#5b4a8a';
const mustard = '#c9a23a';

type CastEntry = [CharacterModel, Outfit, number, number];

const shirt = (color: string, pants: string, shoes: string, extra: Partial<Outfit> = {}): Outfit => ({ top: 'shirt', shirt: color, sleeves: 'long', pants, shoes, ...extra });
const polo = (color: string, pants: string, shoes: string, extra: Partial<Outfit> = {}): Outfit => ({ top: 'polo', shirt: color, sleeves: 'short', pants, shoes, ...extra });

/**
 * Diễn viên theo thứ tự roster sau Giám đốc, khớp STAFFING_ORDER: 1 trưởng phòng TC, 2 Research (An), 3 Analyst, 4 Creative
 * (Bình), 5 Scriptwriter (Hà), 6 Video Producer (Dũng), 7 Publisher. Research, Creative, Scriptwriting là phòng riêng trang trí theo cá
 * tính và mặc đồ hợp phòng: An học giả (gi-lê tweed, kính), Bình hiphop (polo vàng, dây chuyền vàng), Hà nữ tính (áo hồng).
 * Còn lại đồ công sở (sơ mi, quần âu, cà vạt, blazer, thẻ nhân viên); Dũng làm ở Video Studio, đứng sau máy quay.
 * Phần lớn là nam. Không có hai người trùng bộ (đầu, áo, dáng).
 * Không dùng đầu male-c (mũ cảnh sát liền đầu) và male-g (mũ len): mũ của nhân viên do trang phục quyết định.
 */
const CAST: readonly CastEntry[] = [
  // Trưởng phòng (Coordinator) TC: nữ, tóc đỏ đô, blazer đen.
  ['female-e', shirt(white, charcoal, black, { jacket: '#1f2125', hair: '#6d1a24' }), 0.97, 0.96],
  // Research — An, học giả.
  ['male-a', shirt(white, '#5d4636', brown, { vest: '#8a6a4a', tie: forest, glasses: '#3b2a1c' }), 1.04, 1.0],
  // Analyst — công sở.
  ['male-b', shirt(skyBlue, navy, black, { tie: burgundy, badge: '#1b74e4' }), 0.97, 1.04],
  // Creative — Bình, hiphop.
  ['male-e', polo('#f4c430', '#2b2d42', white, { collar: black, chain: true }), 0.98, 1.12],
  // Scriptwriter — Hà, nữ tính, tông hồng.
  ['female-b', shirt('#f7b6c8', cream, '#e8a0b4', { badge: '#ff6fa3' }), 0.95, 0.94],
  // Video Producer — Dũng, công sở năng động (đeo tai nghe khi quay).
  ['male-f', shirt('#5b7fa8', charcoal, brown, { headset: '#2b2d31', badge: '#1b74e4' }), 1.06, 1.1],
  // Publisher — công sở.
  ['male-a', shirt(white, charcoal, black, { tie: navy, jacket: '#3b3f47', badge: red }), 1.02, 0.98],
  ['female-a', shirt(lavender, grey, black, { badge: '#1b74e4' }), 0.93, 0.92],
  ['male-b', shirt(silver, black, black, { tie: red, headset: '#2b2d31' }), 0.96, 1.0],
  ['male-e', shirt(mint, grey, brown, { badge: navy }), 0.99, 1.1],
  ['male-f', shirt(white, charcoal, black, { jacket: '#1f2125', tie: forest }), 1.06, 1.02],
  ['male-a', shirt(skyBlue, khaki, darkBrown, { jacket: '#b9a27c' }), 1.02, 1.04],
  ['female-c', shirt(cream, navy, brown, { glasses: '#8a5a3c' }), 0.94, 0.98],
  ['male-e', shirt(white, navy, black, { tie: mustard, badge: red }), 1.04, 0.97],
  ['male-a', polo('#4a5a6a', charcoal, black), 0.95, 1.06],
  ['male-b', shirt(paleBlue, charcoal, black, { jacket: '#26324a', tie: burgundy }), 1.01, 1.08],
  ['male-e', shirt(pink, navy, brown, { glasses: black }), 1.06, 0.95],
  ['female-d', shirt(white, grey, black, { vest: charcoal }), 0.97, 0.96],
  ['male-f', shirt(silver, navy, black, { tie: navy, headset: '#e8e8e8' }), 0.98, 1.02],
  ['male-a', shirt(white, black, black, { vest: navy, tie: red }), 1.03, 1.1],
  ['male-f', shirt(lavender, charcoal, black, { jacket: '#3b3f47' }), 0.97, 1.0],
  ['male-e', polo(white, khaki, brown, { badge: navy }), 1.0, 0.94],
];

/** Ngoại hình của người thứ `index` trong roster (0 = Giám đốc). Ngoài danh sách thì lặp lại với dáng khác. */
export function appearanceFor(index: number): Appearance {
  if (index === 0) return { model: DIRECTOR_MODEL, height: 1.06, width: 1.02 };
  const k = (index - 1) % CAST.length;
  const lap = Math.floor((index - 1) / CAST.length);
  const [model, outfit, height, width] = CAST[k]!;
  return { model, outfit, height: lap ? 2.0 - height : height, width: lap ? 2.0 - width : width };
}
