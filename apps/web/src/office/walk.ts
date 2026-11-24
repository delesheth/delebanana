// Tìm đường cho nhân vật trên lưới ô 0,25 m: chỉ đi trên sàn phòng/hành lang, qua cửa, không xuyên vách hay đồ đạc.
// A* 8 hướng (không cắt góc), rồi kéo thẳng đường (bỏ điểm thừa khi nhìn thấy nhau). Đường đi là hiệu ứng chuyển tiếp,
// không phải trạng thái (boundaries.md).

import { planFor, wallSegments, type Plan, type Point, type Seat } from './plan.ts';

export const CELL = 0.25;
/** Bán kính nhân vật: vật cản được nới thêm khoảng này. */
export const AGENT_RADIUS = 0.25;
const WALL_HALF = 0.05;

export class WalkGrid {
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;

  constructor(plan: Plan) {
    const areas = [...plan.rooms.map((r) => r.rect), ...plan.corridors];
    this.x0 = Math.min(...areas.map((r) => r.x0)) - CELL;
    this.z0 = Math.min(...areas.map((r) => r.z0)) - CELL;
    this.cols = Math.ceil((Math.max(...areas.map((r) => r.x1)) + CELL - this.x0) / CELL);
    this.rows = Math.ceil((Math.max(...areas.map((r) => r.z1)) + CELL - this.z0) / CELL);
    const n = this.cols * this.rows;

    // Sàn đi được = hợp các phòng và hành lang, co vào một bán kính nhân vật so với phần ngoài tòa nhà.
    const floor = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const { x, z } = this.center(i);
      floor[i] = areas.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ? 1 : 0;
    }
    this.blocked = new Uint8Array(n);
    const reach = Math.ceil(AGENT_RADIUS / CELL);
    for (let i = 0; i < n; i++) {
      const c = i % this.cols;
      const r = Math.floor(i / this.cols);
      let ok = floor[i] === 1;
      for (let dr = -reach; ok && dr <= reach; dr++)
        for (let dc = -reach; ok && dc <= reach; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows || floor[rr * this.cols + cc] === 0) ok = false;
        }
      this.blocked[i] = ok ? 0 : 1;
    }

    const pad = WALL_HALF + AGENT_RADIUS;
    for (const room of plan.rooms)
      for (const s of wallSegments(room)) this.blockRect(Math.min(s.x0, s.x1) - pad, Math.min(s.z0, s.z1) - pad, Math.max(s.x0, s.x1) + pad, Math.max(s.z0, s.z1) + pad);
    for (const o of plan.obstacles) {
      if (o.round) this.blockCircle(o.x, o.z, o.hx + AGENT_RADIUS);
      else this.blockRect(o.x - o.hx - AGENT_RADIUS, o.z - o.hz - AGENT_RADIUS, o.x + o.hx + AGENT_RADIUS, o.z + o.hz + AGENT_RADIUS);
    }
  }

  private center(i: number): Point {
    return { x: this.x0 + ((i % this.cols) + 0.5) * CELL, z: this.z0 + (Math.floor(i / this.cols) + 0.5) * CELL };
  }

  private index(p: Point): number {
    const c = Math.floor((p.x - this.x0) / CELL);
    const r = Math.floor((p.z - this.z0) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private blockRect(x0: number, z0: number, x1: number, z1: number) {
    for (let i = 0; i < this.blocked.length; i++) {
      const { x, z } = this.center(i);
      if (x > x0 && x < x1 && z > z0 && z < z1) this.blocked[i] = 1;
    }
  }

  private blockCircle(cx: number, cz: number, radius: number) {
    for (let i = 0; i < this.blocked.length; i++) {
      const { x, z } = this.center(i);
      if (Math.hypot(x - cx, z - cz) < radius) this.blocked[i] = 1;
    }
  }

  free(p: Point): boolean {
    const i = this.index(p);
    return i >= 0 && this.blocked[i] === 0;
  }

  /** Đoạn thẳng a→b không chạm ô cấm. */
  clear(a: Point, b: Point): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.4)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (!this.free({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }

  /** Ô trống gần nhất (vòng vuông nở dần), cho điểm đầu/cuối lỡ nằm sát vật cản. */
  private nearestFree(p: Point): number {
    const i = this.index(p);
    if (i >= 0 && this.blocked[i] === 0) return i;
    const c0 = Math.floor((p.x - this.x0) / CELL);
    const r0 = Math.floor((p.z - this.z0) / CELL);
    for (let d = 1; d < 12; d++)
      for (let dr = -d; dr <= d; dr++)
        for (let dc = -d; dc <= d; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          if (this.blocked[r * this.cols + c] === 0) return r * this.cols + c;
        }
    return -1;
  }

  /** Đường a → b (không gồm a, gồm b); `null` khi không có lối. */
  findPath(a: Point, b: Point): Point[] | null {
    const start = this.nearestFree(a);
    const goal = this.nearestFree(b);
    if (start < 0 || goal < 0) return null;
    const cells = this.astar(start, goal);
    if (!cells) return null;
    const raw: Point[] = [a, ...cells.slice(1, -1).map((i) => this.center(i)), b];
    // Kéo thẳng: từ mỗi điểm nhảy tới điểm xa nhất còn nhìn thấy. Đoạn đầu/cuối có thể nằm trong vùng nới (ghế, sofa) nên chỉ
    // kiểm tra phần giữa.
    const out: Point[] = [];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.clear(raw[i]!, raw[j]!)) j--;
      out.push(raw[j]!);
      i = j;
    }
    return out;
  }

  private astar(start: number, goal: number): number[] | null {
    const n = this.blocked.length;
    const g = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gc = goal % this.cols;
    const gr = Math.floor(goal / this.cols);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gc);
      const dz = Math.abs(Math.floor(i / this.cols) - gr);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === goal) {
        const path: number[] = [];
        for (let k = goal; k !== -1; k = from[k]!) path.push(k);
        return path.reverse();
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const c = cur % this.cols;
      const r = Math.floor(cur / this.cols);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) continue;
          const next = rr * this.cols + cc;
          if (this.blocked[next] || closed[next]) continue;
          // Không cắt góc vật cản khi đi chéo.
          if (dr !== 0 && dc !== 0 && (this.blocked[r * this.cols + cc] || this.blocked[rr * this.cols + c])) continue;
          const cost = g[cur]! + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
          if (cost < g[next]!) {
            g[next] = cost;
            from[next] = cur;
            heap.push(next, cost + h(next));
          }
        }
    }
    return null;
  }
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

const grids = new Map<number, WalkGrid>();
export function gridFor(moduleCount: number): WalkGrid {
  let g = grids.get(moduleCount);
  if (!g) {
    g = new WalkGrid(planFor(moduleCount));
    grids.set(moduleCount, g);
  }
  return g;
}

const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-3;

/**
 * Đường đi từ vị trí hiện tại tới chỗ ngồi mới: đứng dậy ra điểm tiếp cận của chỗ cũ (nếu đang ngồi), đi theo lưới tới điểm
 * tiếp cận của chỗ mới, rồi vào chỗ.
 */
export function walkPath(from: Point, fromSeat: Seat | undefined, to: Seat, moduleCount: number): Point[] {
  const grid = gridFor(moduleCount);
  const out: Point[] = [];
  let start = from;
  if (fromSeat && near(from, fromSeat) && !near(fromSeat, fromSeat.approach)) {
    out.push(fromSeat.approach);
    start = fromSeat.approach;
  }
  out.push(...(grid.findPath(start, to.approach) ?? [to.approach]));
  if (!near(to.approach, to)) out.push({ x: to.x, z: to.z });
  return out.filter((p, i) => !near(p, i === 0 ? from : out[i - 1]!));
}
