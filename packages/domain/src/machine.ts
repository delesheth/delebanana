// Bộ kiểm đường chuyển trạng thái dùng chung (TK2 mục 3). Hàm thuần: backend gọi trong `transition()`
// trước khi ghi DB; mọi đổi trạng thái phải khớp một dòng khai báo.

export type Actor = 'user' | 'system' | `agent:${string}`;
export type ActorKind = 'user' | 'system' | 'agent';

export interface Transition<S extends string, C> {
  from: S;
  to: S;
  by: readonly ActorKind[];
  /** Điều kiện thêm (có thể phụ thuộc tác nhân); trả chuỗi lý do khi không đạt. */
  guard?: (ctx: C, by: ActorKind) => string | null;
}

export interface Machine<S extends string, C = void> {
  name: string;
  states: readonly S[];
  terminal: readonly S[];
  transitions: readonly Transition<S, C>[];
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function defineMachine<S extends string, C = void>(m: Machine<S, C>): Machine<S, C> {
  const known = new Set<string>(m.states);
  for (const t of m.transitions) {
    if (!known.has(t.from) || !known.has(t.to)) throw new Error(`${m.name}: ${t.from} → ${t.to} dùng trạng thái không khai báo`);
    if (t.from === t.to) throw new Error(`${m.name}: không khai báo chuyển về chính nó (${t.from})`);
    if (m.terminal.includes(t.from)) throw new Error(`${m.name}: trạng thái kết thúc ${t.from} không được có đường ra`);
  }
  return m;
}

export function actorKind(a: Actor): ActorKind {
  return a.startsWith('agent:') ? 'agent' : (a as ActorKind);
}

export function checkTransition<S extends string, C>(m: Machine<S, C>, from: string, to: string, actor: Actor, ctx: C): TransitionResult {
  const t = m.transitions.find((x) => x.from === from && x.to === to);
  if (!t) return { ok: false, reason: `${m.name}: không có đường chuyển ${from} → ${to}` };
  const kind = actorKind(actor);
  if (!t.by.includes(kind)) return { ok: false, reason: `${m.name}: ${from} → ${to} không dành cho tác nhân ${kind}` };
  const failed = t.guard?.(ctx, kind);
  return failed ? { ok: false, reason: failed } : { ok: true };
}

export function nextStates<S extends string, C>(m: Machine<S, C>, from: S): S[] {
  return m.transitions.filter((t) => t.from === from).map((t) => t.to);
}
