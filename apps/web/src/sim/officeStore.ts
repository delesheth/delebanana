// Store của văn phòng 3D, nằm ngoài React để vòng lặp khung hình không gây re-render.
// Trạng thái Agent chỉ đổi qua snapshot/sự kiện của server (xem live/connection.ts); vị trí/animation suy ra từ trạng thái.

import {
  STAFFING_ORDER,
  STATE_BEHAVIOR,
  applyEvent,
  applySnapshot,
  emptyClientState,
  type AgentRole,
  type AgentState,
  type AnimationKind,
  type ClientState,
  type DomainEvent,
  type EventDataMap,
  type ServerSnapshot,
  type StatusIcon,
} from '@delebanana/domain';
import type { ConnectionStatus } from '../live/connection.ts';
import { appearanceFor } from '../office/appearance.ts';
import { SeatAllocator, resolveTarget, type SeatAssignment } from '../office/layout.ts';
import { step, type Mover } from '../office/motion.ts';
import type { AgentProfile } from '../office/roster.ts';
import { walkPath } from '../office/walk.ts';

export type { ConnectionStatus };

/** Kết quả áp một sự kiện: `unknown_agent` = sự kiện nhắc tới Agent mà snapshot hiện tại không có (cần đồng bộ lại). */
export type ReceiveResult = 'ok' | 'unknown_agent';

export type RenderMode = 'auto' | 'detailed' | 'instanced';

export interface OfficeSettings {
  renderMode: RenderMode;
  /** Ngưỡng số Agent để `auto` chuyển sang instanced (LOD/gộp, D-5). */
  instancedThreshold: number;
  decorative: boolean;
  shadows: boolean;
}

export interface AgentRuntime {
  profile: AgentProfile;
  mover: Mover;
  assignment: SeatAssignment;
  animation: AnimationKind;
  icon: StatusIcon;
  arrived: boolean;
  phase: number;
  /** Đang xếp hàng ở cửa chính chờ tới lượt đi vào (giây). */
  enterDelay?: number;
}

/** Trạng thái của trưởng phòng khiến cả đội vào họp. */
const HUDDLE_STATES = new Set<AgentState>(['planning', 'reviewing']);

/** Cửa chính: lối vào giữa hai phòng hàng nam, mặt nam tòa nhà. */
export const ENTRANCE = { x: 0, z: 15 };
/** Giãn cách giữa hai nhân viên đi vào khi văn phòng mở cửa. */
const ENTER_GAP_SECONDS = 0.45;

export interface Metrics {
  /** Số khung và thời gian (s) của cửa sổ đo vừa xong; dùng để cộng dồn chính xác khi đo tự động. */
  frames: number;
  seconds: number;
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

type Listener = () => void;

const DEFAULT_SETTINGS: OfficeSettings = {
  renderMode: 'auto',
  instancedThreshold: 120,
  decorative: true,
  shadows: true,
};

/** Cho phép mở thẳng một cấu hình dựng, ví dụ `?mode=instanced&shadows=0`. */
function settingsFromUrl(): Partial<OfficeSettings> {
  if (typeof location === 'undefined') return {};
  const q = new URLSearchParams(location.search);
  const out: Partial<OfficeSettings> = {};
  const mode = q.get('mode');
  if (mode === 'auto' || mode === 'detailed' || mode === 'instanced') out.renderMode = mode;
  if (q.has('shadows')) out.shadows = q.get('shadows') !== '0';
  if (q.has('decorative')) out.decorative = q.get('decorative') !== '0';
  return out;
}

/** Roster ổn định giữa các lần nối lại: theo thứ tự vai trò của đội (D-18) rồi theo id, để ghế và ngoại hình không xáo trộn. */
function sortRoster(entries: ServerSnapshot['roster']): ServerSnapshot['roster'] {
  const rank = (role: string) => {
    const i = STAFFING_ORDER.indexOf(role as (typeof STAFFING_ORDER)[number]);
    return i < 0 ? STAFFING_ORDER.length : i;
  };
  return [...entries].sort((a, b) => rank(a.role) - rank(b.role) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

class OfficeStore {
  settings: OfficeSettings = { ...DEFAULT_SETTINGS, ...settingsFromUrl() };
  roster: AgentProfile[] = [];
  runtimes: AgentRuntime[] = [];
  states: ClientState = emptyClientState;
  connection: ConnectionStatus = 'connecting';
  /** Người dùng vừa bấm Stop: tắt đèn ngay, không đợi server ngắt hẳn. */
  private shuttingDown = false;
  /** Đã tắt đèn (mất server): lần nạp snapshot tới, nhân viên đi từ cửa chính vào chỗ. */
  private walkInPending = false;
  /** Còn chiến dịch chưa xong: nhân viên rảnh vẫn ngồi bàn, không ra bar. */
  private atWork = false;
  /** Trưởng phòng đang chia việc/duyệt: trưởng phòng và mọi nhân viên (trừ Giám đốc) họp ở Meeting Room. */
  private huddle = false;
  metrics: Metrics = { frames: 0, seconds: 0, fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
  selectedId: string | null = null;
  /** Đổi khi roster/bố cục đổi (số module bàn), để scene dựng lại nội thất. */
  layoutVersion = 0;
  moduleCount = 1;

  private allocator = new SeatAllocator();
  private byId = new Map<string, AgentRuntime>();
  /** Mọi Agent server biết (cả Workspace khác): sự kiện của họ không phải "agent lạ" dù không hiện trong văn phòng. */
  private knownIds = new Set<string>();
  /** Agent đã gây một lần đồng bộ lại mà snapshot vẫn không có (đã lưu trữ) → bỏ qua sự kiện của họ. */
  private unknownIds = new Set<string>();
  private uiListeners = new Set<Listener>();
  private metricListeners = new Set<Listener>();
  private uiSnapshot = this.makeUi();

  // ---- Đăng ký cho React (useSyncExternalStore) ----
  subscribeUi = (l: Listener) => {
    this.uiListeners.add(l);
    return () => this.uiListeners.delete(l);
  };
  getUi = () => this.uiSnapshot;
  subscribeMetrics = (l: Listener) => {
    this.metricListeners.add(l);
    return () => this.metricListeners.delete(l);
  };
  getMetrics = () => this.metrics;

  private makeUi() {
    return {
      settings: this.settings,
      selectedId: this.selectedId,
      layoutVersion: this.layoutVersion,
      lastSeq: this.states.lastSeq,
      connection: this.connection,
      agentCount: this.roster.length,
      lightsOn: this.lightsOn(),
    };
  }

  private notifyUi() {
    this.uiSnapshot = this.makeUi();
    for (const l of this.uiListeners) l();
  }

  setMetrics(m: Metrics) {
    this.metrics = m;
    for (const l of this.metricListeners) l();
  }

  // ---- Thao tác ----
  updateSettings(patch: Partial<OfficeSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.notifyUi();
  }

  setConnection(c: ConnectionStatus) {
    if (c === this.connection) return;
    this.connection = c;
    if (c === 'offline') this.walkInPending = true;
    if (c === 'online') this.shuttingDown = false;
    this.notifyUi();
  }

  /** Văn phòng sáng đèn và có người: server đang chạy (lúc mở trang, đang kết nối lần đầu cũng coi là sáng). */
  lightsOn(): boolean {
    return this.connection !== 'offline' && !this.shuttingDown;
  }

  /** Đang họp khi trưởng phòng chia việc (`planning`) hoặc duyệt bài (`reviewing`). */
  private computeHuddle(): boolean {
    const coord = this.runtimes.find((rt) => rt.profile.role === 'coordinator');
    return !!coord && HUDDLE_STATES.has(this.stateOf(coord.profile.id));
  }

  /** Bắt đầu/kết thúc buổi họp thì cả đội đổi chỗ. */
  private syncHuddle() {
    const next = this.computeHuddle();
    if (next === this.huddle) return false;
    this.huddle = next;
    for (const rt of this.runtimes) this.moveTo(rt, this.stateOf(rt.profile.id));
    return true;
  }

  /** Bật/tắt giờ làm việc (còn chiến dịch chưa xong); nhân viên rảnh đi về bàn hoặc ra bar ngay. */
  setWorkday(atWork: boolean) {
    if (atWork === this.atWork) return;
    this.atWork = atWork;
    for (const rt of this.runtimes) this.moveTo(rt, this.stateOf(rt.profile.id));
    this.notifyUi();
  }

  /** Bấm Stop: tắt đèn, nhân viên biến mất ngay; bật lại khi server online. */
  beginShutdown() {
    this.shuttingDown = true;
    this.walkInPending = true;
    this.notifyUi();
  }

  /** Huỷ tắt (gọi Stop không thành công). */
  cancelShutdown() {
    this.shuttingDown = false;
    this.notifyUi();
  }

  select(id: string | null) {
    this.selectedId = id;
    this.notifyUi();
  }

  stateOf(id: string): AgentState {
    return this.states.agents[id]?.state ?? 'offline';
  }

  /** Task hiện tại của Agent (id task từ sự kiện của server). */
  taskOf(id: string): string | undefined {
    return this.states.agents[id]?.taskId;
  }

  runtime(id: string): AgentRuntime | undefined {
    return this.byId.get(id);
  }

  effectiveMode(): Exclude<RenderMode, 'auto'> {
    const s = this.settings;
    if (s.renderMode !== 'auto') return s.renderMode;
    return this.roster.length > s.instancedThreshold ? 'instanced' : 'detailed';
  }

  /** Cần lấy snapshot mới (phát hiện hở số thứ tự). */
  needsResync(): boolean {
    return this.states.needsResync;
  }

  /**
   * Nạp snapshot của server. Roster đổi (hoặc lần đầu) → dựng lại văn phòng, mỗi Agent đặt ngay tại chỗ theo trạng thái;
   * roster giữ nguyên (nối lại) → chỉ cập nhật trạng thái và để Agent đi bộ tới đích mới.
   * Chỉ hiện Workspace đầu tiên (server seed một Workspace).
   */
  loadSnapshot(snap: ServerSnapshot) {
    // Snapshot thay thế hẳn trạng thái, kể cả khi seq thấp hơn (server được dựng lại).
    this.states = applySnapshot(emptyClientState, snap);
    this.knownIds = new Set(snap.roster.map((r) => r.id));
    for (const id of this.knownIds) this.unknownIds.delete(id);
    const workspaceId = snap.workspaces[0]?.id;
    const entries = sortRoster(snap.roster.filter((r) => r.workspaceId === workspaceId));
    const same = entries.length === this.roster.length && entries.every((e, i) => e.id === this.roster[i]!.id);
    if (same) {
      this.huddle = this.computeHuddle();
      for (const rt of this.runtimes) this.moveTo(rt, this.stateOf(rt.profile.id));
    } else this.rebuild(entries);
    if (this.walkInPending) {
      this.walkInPending = false;
      this.walkIn();
    }
    this.notifyUi();
  }

  /** Mở cửa văn phòng: mọi người xếp hàng ở cửa chính rồi lần lượt đi vào chỗ của mình. */
  private walkIn() {
    this.runtimes.forEach((rt, i) => {
      rt.mover.x = ENTRANCE.x + ((i % 3) - 1) * 0.45;
      rt.mover.z = ENTRANCE.z;
      rt.mover.heading = Math.PI;
      rt.mover.path = walkPath(rt.mover, undefined, rt.assignment.seat, this.allocator.moduleCount);
      rt.arrived = false;
      rt.enterDelay = i * ENTER_GAP_SECONDS;
    });
  }

  private rebuild(entries: ServerSnapshot['roster']) {
    this.allocator = new SeatAllocator();
    this.roster = entries.map((e, i) => ({ id: e.id, name: e.name, role: e.role, appearance: appearanceFor(i) }));
    this.byId.clear();
    // Mỗi Agent nhận bàn cố định ngay khi dựng roster (theo thứ tự), trước khi ra chỗ theo trạng thái.
    for (const p of this.roster) this.allocator.register(p.id, p.role);
    const coord = this.roster.find((p) => p.role === 'coordinator');
    this.huddle = !!coord && HUDDLE_STATES.has(this.stateOf(coord.id));
    this.runtimes = this.roster.map((profile, i) => {
      const state = this.stateOf(profile.id);
      const assignment = this.allocator.place(profile.id, this.targetOf(state, profile.role));
      const b = STATE_BEHAVIOR[state];
      const rt: AgentRuntime = {
        profile,
        assignment,
        mover: { x: assignment.seat.x, z: assignment.seat.z, heading: assignment.seat.facing, path: [] },
        animation: b.animation,
        icon: b.icon,
        arrived: true,
        phase: (i * 2.399) % (Math.PI * 2),
      };
      this.byId.set(profile.id, rt);
      return rt;
    });
    if (this.selectedId && !this.byId.has(this.selectedId)) this.selectedId = null;
    this.moduleCount = this.allocator.moduleCount;
    this.layoutVersion++;
    this.notifyUi();
  }

  /** Điểm vào duy nhất cho sự kiện của server. Luôn áp để `seq` tăng liên tục; chỉ `agent.state_changed` làm Agent di chuyển. */
  receive(e: DomainEvent): ReceiveResult {
    const before = this.states;
    this.states = applyEvent(before, e);
    if (this.states === before) return 'ok';
    if (e.type !== 'agent.state_changed') {
      this.notifyUi();
      return 'ok';
    }
    const rt = this.byId.get(e.entity.id);
    if (!rt) {
      this.notifyUi();
      const id = e.entity.id;
      if (this.knownIds.has(id) || this.unknownIds.has(id)) return 'ok';
      // Lần đầu thấy: có thể là Agent mới → đồng bộ lại. Nếu snapshot vẫn không có (đã lưu trữ), lần sau bỏ qua.
      this.unknownIds.add(id);
      return 'unknown_agent';
    }
    if (!(rt.profile.role === 'coordinator' && this.syncHuddle())) this.moveTo(rt, (e.data as EventDataMap['agent.state_changed']).state);
    this.notifyUi();
    return 'ok';
  }

  /** Đổi đích và animation theo trạng thái; Agent đi bộ nếu chỗ mới khác chỗ cũ. */
  /** Đích theo trạng thái; đang họp thì mọi người (trừ Giám đốc) vào Meeting Room. */
  private targetOf(state: AgentState, role: AgentRole) {
    return this.huddle && role !== 'director' ? resolveTarget('in_meeting', role) : resolveTarget(state, role, this.atWork);
  }

  private moveTo(rt: AgentRuntime, state: AgentState) {
    const inHuddle = this.huddle && rt.profile.role !== 'director';
    // Người rảnh trong buổi họp thì ngồi họp (không ngồi im như lúc nghỉ).
    const behavior = STATE_BEHAVIOR[inHuddle && state === 'idle' ? 'in_meeting' : state];
    const next = this.allocator.place(rt.profile.id, this.targetOf(state, rt.profile.role));
    if (next.seat === rt.assignment.seat) rt.assignment = next;
    else {
      const leaving = rt.arrived ? rt.assignment.seat : undefined;
      rt.assignment = next;
      rt.mover.path = walkPath(rt.mover, leaving, next.seat, this.allocator.moduleCount);
      rt.arrived = false;
    }
    rt.animation = behavior.animation;
    rt.icon = behavior.icon;
    if (this.allocator.moduleCount !== this.moduleCount) {
      this.moduleCount = this.allocator.moduleCount;
      this.layoutVersion++;
    }
  }

  /** Gọi mỗi khung hình từ scene: chỉ bước di chuyển, không sinh sự kiện. */
  update(dt: number) {
    for (const rt of this.runtimes) {
      if (rt.arrived) continue;
      if (rt.enterDelay && rt.enterDelay > 0) {
        rt.enterDelay -= dt;
        continue;
      }
      if (step(rt.mover, dt)) {
        rt.arrived = true;
        rt.mover.heading = rt.assignment.seat.facing;
      }
    }
  }
}

export const office = new OfficeStore();
