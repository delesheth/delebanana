# Domain lifecycle & events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến TK2 thành mã thuần trong `packages/domain`: state machine cho 6 thực thể, `deriveAgentState`, kiểu sự kiện `DomainEvent` và reducer phía client; spike S4 (`apps/web`) chuyển sang sự kiện mới.

**Architecture:** Một helper state machine chung (bảng chuyển + tác nhân + điều kiện), mỗi thực thể một tệp khai báo bảng chuyển đúng như TK2 mục 4. Hàm thuần, không phụ thuộc SQLite: backend sau này gọi `checkTransition` trong `transition()`; UI/3D dùng kiểu sự kiện và reducer.

**Tech Stack:** TypeScript 7, vitest 5, pnpm workspace.

**Spec:** `docs/design/02-lifecycle-events.md` (dựa trên `docs/design/01-domain-model.md`).

## Global Constraints

- Mã thuần, không thêm dependency mới (không thư viện state machine).
- Package đổi tên `packages/agent-state` → `packages/domain`, tên `@delebanana/domain`; import dùng đuôi `.ts` như mã hiện có.
- Chú thích và thông báo lỗi bằng tiếng Việt, như mã hiện có.
- Không thêm API trả phí (D-14).
- Kiểm thử: `pnpm test` (= `vitest run`), typecheck: `pnpm typecheck`, build web: `pnpm build`.
- Không commit trừ khi người dùng bảo; bước "Commit" trong kế hoạch = dừng lại báo người dùng nếu chưa được phép.

## Review Focus

- Trạng thái lạ đọc từ DB (chuỗi không thuộc union) → `checkTransition` trả lỗi, không ném ngoại lệ. (Task 2)
- Trạng thái kết thúc (`completed`, `cancelled`, `done`, `failed` của Task, `published`, `approved`…) không có đường ra nào. (Task 3)
- Chuyển về chính nó (`from === to`) luôn bị từ chối. (Task 2)
- Tác nhân `agent:<id>` gọi đường chuyển chỉ dành cho `system`/`user` bị từ chối. (Task 2, Task 3)
- `deriveAgentState` không bao giờ trả trạng thái ngoài `statesForRole(role)` với dữ kiện hợp lệ cho vai trò đó. (Task 4)

---

### Task 1: Đổi tên package thành `@delebanana/domain`

**Files:**
- Move: `packages/agent-state/` → `packages/domain/`
- Modify: `packages/domain/package.json` (`"name": "@delebanana/domain"`)
- Modify: `apps/web/package.json` (dependency `@delebanana/domain: workspace:*`, bỏ `@delebanana/agent-state`)
- Modify: mọi import `@delebanana/agent-state` trong `apps/web/src` (danh sách: `ui/AgentPanel.tsx`, `office/{clips,clips.test,layout}.ts`, `scene/{ZoneLabels,Rooms}.tsx`, `scene/palette.ts`, `sim/{officeStore,simulator,simulator.test}.ts`)
- Modify: `docs/design/01-domain-model.md`, `docs/design/02-lifecycle-events.md`, `docs/superpowers/specs/2026-11-17-s4-3d-office-design.md` — đổi tên package trong văn bản

**Interfaces:**
- Produces: `@delebanana/domain` xuất mọi thứ `@delebanana/agent-state` từng xuất.

- [ ] **Step 1:** `git mv packages/agent-state packages/domain`, sửa tên, sửa import, chạy `pnpm install`.
- [ ] **Step 2:** Chạy `pnpm test && pnpm typecheck`. Expected: 26 tests pass, typecheck không lỗi.
- [ ] **Step 3: Commit** — `refactor: rename agent-state package to domain`

### Task 2: Helper state machine

**Files:**
- Create: `packages/domain/src/machine.ts`
- Test: `packages/domain/src/machine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Actor = 'user' | 'system' | `agent:${string}`;
  export type ActorKind = 'user' | 'system' | 'agent';
  export interface Transition<S extends string, C> {
    from: S; to: S; by: readonly ActorKind[];
    /** Điều kiện thêm; trả chuỗi lý do khi không đạt. */
    guard?: (ctx: C) => string | null;
  }
  export interface Machine<S extends string, C = void> {
    name: string; states: readonly S[]; terminal: readonly S[];
    transitions: readonly Transition<S, C>[];
  }
  export type TransitionResult = { ok: true } | { ok: false; reason: string };
  export function defineMachine<S extends string, C = void>(m: Machine<S, C>): Machine<S, C>;
  export function actorKind(a: Actor): ActorKind;
  export function checkTransition<S extends string, C>(m: Machine<S, C>, from: string, to: string, actor: Actor, ctx: C): TransitionResult;
  export function nextStates<S extends string, C>(m: Machine<S, C>, from: S): S[];
  ```
- `defineMachine` ném lỗi khi khai báo sai: trạng thái trong `transitions` không thuộc `states`, trạng thái `terminal` có đường ra.

- [ ] **Step 1: Viết test thất bại** — dùng một máy mẫu `a → b (system)`, `b → c (user, guard)`, terminal `c`:
  - `checkTransition(m,'a','b','system')` → `{ ok: true }`
  - `checkTransition(m,'a','b','user')` → `ok: false`, `reason` chứa `'user'`
  - `checkTransition(m,'a','b','agent:x')` → `ok: false`
  - `checkTransition(m,'a','a','system')` → `ok: false`
  - `checkTransition(m,'zzz','b','system')` → `ok: false`, không ném
  - guard trả `'thiếu X'` → `{ ok: false, reason: 'thiếu X' }`
  - `defineMachine` với terminal có đường ra → ném lỗi
  - `nextStates(m,'a')` → `['b']`; `actorKind('agent:abc')` → `'agent'`
- [ ] **Step 2:** `pnpm test packages/domain/src/machine.test.ts` → FAIL (chưa có module).
- [ ] **Step 3:** Cài đặt trong `machine.ts`.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5: Commit** — `feat(domain): add generic state machine helper`

### Task 3: Sáu state machine theo TK2 mục 4

**Files:**
- Create: `packages/domain/src/lifecycle/{campaign,stage,task,videoVersion,post,approval}.ts`, `packages/domain/src/lifecycle/index.ts`
- Test: `packages/domain/src/lifecycle/lifecycle.test.ts`
- Modify: `packages/domain/src/index.ts` (xuất `./machine.ts`, `./lifecycle/index.ts`)

**Interfaces:**
- Consumes: `defineMachine`, `checkTransition`, `nextStates` (Task 2).
- Produces (mỗi tệp một union trạng thái + một máy):
  - `CampaignStatus = 'briefing'|'active'|'paused'|'completed'|'cancelled'`; `campaignMachine: Machine<CampaignStatus, { brief?: CampaignBrief }>`; `interface CampaignBrief { goal?: string; audience?: string; product?: string; platforms?: Platform[] }`; `isBriefComplete(b: CampaignBrief): boolean`; `type Platform = 'tiktok'|'facebook'|'instagram'`.
  - `StageName = 'research'|'scripting'|'video'|'publishing'|'analytics'`; `STAGE_ORDER: readonly StageName[]`; `STAGE_GATE: Record<StageName, ApprovalKind | null>` (`scripting: 'choose_script'`, `video: 'approve_video'`, `publishing: 'approve_publish'`, còn lại `null`); `StageStatus = 'pending'|'running'|'awaiting_approval'|'done'|'skipped'`; `stageMachine: Machine<StageStatus, { stage: StageName }>`.
  - `TaskStatus = 'queued'|'assigned'|'running'|'waiting'|'in_review'|'done'|'failed'|'cancelled'`; `TaskKind` = `'research.trend'|'research.competitor'|'research.audience'|'research.synthesis'|'planning'|'ideation'|'script'|'video.prompt'|'video.template_render'|'caption'|'publish'|'analysis'`; `MAX_ATTEMPTS = 3`; `MAX_CLI_RETRIES = 2`; `needsReview(kind: TaskKind): boolean` (false với `research.synthesis`, `planning` — việc Coordinator tự làm; true với loại khác. Task đi qua `waiting` kết thúc bằng `waiting → done`, không qua hàm này); `taskMachine: Machine<TaskStatus, { attempt: number }>`.
  - `VideoVersionStatus = 'requested'|'awaiting_upload'|'rendering'|'ready'|'invalid'|'approved'|'rejected'|'failed'`; `VideoProvider = 'manual'|'template'`; `videoVersionMachine`.
  - `PostStatus = 'draft'|'awaiting_approval'|'scheduled'|'publishing'|'published'|'draft_uploaded'|'failed'|'cancelled'`; `MAX_PUBLISH_RETRIES = 3`; `postMachine`.
  - `ApprovalKind = 'choose_script'|'make_video'|'approve_video'|'approve_publish'|'out_of_permission'|'limit_override'`; `ApprovalStatus = 'pending'|'approved'|'rejected'|'changes_requested'|'expired'`; `approvalMachine`.
- Bảng chuyển, tác nhân: chép đúng TK2 mục 4.1–4.6 (sơ đồ và bảng). Điểm cần chú ý:
  - Campaign `briefing → active`: by `agent`, guard `isBriefComplete` (lý do: `'brief thiếu trường bắt buộc'`).
  - Task `in_review → queued`: by `agent`, guard `attempt < MAX_ATTEMPTS`; `in_review → failed`: by `system`, guard `attempt >= MAX_ATTEMPTS`; `in_review → done`: by `agent`; `waiting → done|failed|cancelled`: by `system`.
  - Post `failed → publishing`: by `system` và `user`.
  - Terminal: Campaign `completed`,`cancelled`; Stage `done`,`skipped`; Task `done`,`failed`,`cancelled`; VideoVersion `approved`,`rejected`; Post `published`,`draft_uploaded`,`cancelled`; Approval mọi trạng thái trừ `pending`.

- [ ] **Step 1: Viết test thất bại** — test theo bảng, mỗi máy một bảng `[from, to, actorKind]` kỳ vọng hợp lệ chép từ TK2:
  - Với mỗi máy: mọi cặp `(from, to)` trong bảng → `ok` với tác nhân khai báo; **mọi cặp khác** trong `states × states` → `ok: false` với cả ba tác nhân (vòng lặp đầy đủ).
  - Mọi trạng thái terminal: `nextStates(m, s)` là `[]`.
  - `isBriefComplete({ goal:'a', audience:'b', product:'c', platforms:['tiktok'] })` → true; thiếu `platforms` hoặc `platforms: []` → false.
  - Task: `checkTransition(taskMachine,'in_review','queued','agent:c',{attempt:2})` ok; `{attempt:3}` → không ok; `'in_review','failed','system',{attempt:3}` ok, `{attempt:1}` không ok.
  - `STAGE_GATE.scripting === 'choose_script'`, `STAGE_ORDER` đúng thứ tự 5 bước.
- [ ] **Step 2:** `pnpm test packages/domain/src/lifecycle` → FAIL.
- [ ] **Step 3:** Cài đặt sáu tệp.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5: Commit** — `feat(domain): add lifecycle state machines from TK2`

### Task 4: `deriveAgentState` và cập nhật `statesForRole`

**Files:**
- Create: `packages/domain/src/deriveAgentState.ts`
- Test: `packages/domain/src/deriveAgentState.test.ts`
- Modify: `packages/domain/src/states.ts` — `statesForRole` dùng bảng `WORK_STATES`
- Modify: `apps/web/src/sim/simulator.ts` — bỏ `allowed[3]`, dùng `WORK_STATES[role][0]`

**Interfaces:**
- Consumes: `AgentState`, `AgentRole`, `statesForRole` (states.ts), `TaskKind` (Task 3).
- Produces:
  ```ts
  export type RunPurpose = 'task' | 'review' | 'chat' | 'planning' | 'briefing';
  export interface AgentFacts {
    role: AgentRole; enabled: boolean; inMeeting: boolean; blocked: boolean;
    activeRun?: { purpose: RunPurpose; taskKind?: TaskKind };
    hasWaitingTask: boolean; hasAssignedTask: boolean;
    awaitingUserReply: boolean; hasPendingApproval: boolean; unseenFailure: boolean;
  }
  export function deriveAgentState(f: AgentFacts): AgentState;
  export function runState(role: AgentRole, run: NonNullable<AgentFacts['activeRun']>): AgentState;
  export const WORK_STATES: Record<AgentRole, readonly AgentState[]>;
  ```
- `deriveAgentState`: đúng thứ tự 10 dòng của TK2 mục 5. `runState`: bảng "Lượt CLI đang chạy" của TK2 mục 5 (Director `chat`/`briefing` → `conversing`; Coordinator `planning` hoặc `taskKind = research.synthesis` → `planning`, `review` → `reviewing`; theo `taskKind` cho Agent khác).
- `WORK_STATES`: `director: ['conversing']`, `coordinator: ['planning','reviewing']`, `researcher: ['researching']`, `creative: ['brainstorming','writing']`, `scriptwriter: ['writing']`, `video_producer: ['generating_video','writing']`, `publisher: ['publishing','writing']`, `analyst: ['analyzing']`. `statesForRole(role)` = chung (`offline`,`idle`,`in_meeting`,`waiting_approval`,`blocked_budget`,`error`) + `WORK_STATES[role]` + (`assigned` nếu không phải director/coordinator) + (`awaiting_user_reply` nếu director).

- [ ] **Step 1: Viết test thất bại:**
  - Mỗi dòng ưu tiên một test: dữ kiện bật đúng dòng đó và mọi dòng thấp hơn → trả trạng thái của dòng đó (vd. `enabled:false, inMeeting:true` → `offline`; `inMeeting:true, blocked:true` → `in_meeting`; `hasWaitingTask:true, hasAssignedTask:true` → `generating_video`; không gì → `idle`).
  - `runState`: `('director',{purpose:'chat'})` → `conversing`; `('coordinator',{purpose:'review'})` → `reviewing`; `('coordinator',{purpose:'task',taskKind:'research.synthesis'})` → `planning`; `('video_producer',{purpose:'task',taskKind:'video.prompt'})` → `writing`; `('analyst',{purpose:'task',taskKind:'analysis'})` → `analyzing`.
  - Bất biến: với mỗi vai trò, liệt kê dữ kiện hợp lệ cho vai trò (taskKind thuộc vai trò, `awaitingUserReply` chỉ cho director) và kiểm `statesForRole(role)` chứa kết quả.
  - Các test cũ trong `states.test.ts` vẫn qua.
- [ ] **Step 2:** `pnpm test packages/domain` → FAIL.
- [ ] **Step 3:** Cài đặt; sửa `statesForRole` và `simulator.ts`.
- [ ] **Step 4:** `pnpm test` → PASS toàn bộ (gồm `simulator.test.ts`).
- [ ] **Step 5: Commit** — `feat(domain): derive agent state from facts`

### Task 5: `DomainEvent` và reducer phía client; S4 dùng sự kiện mới

**Files:**
- Modify: `packages/domain/src/events.ts` — thay `AgentStateEvent` bằng `DomainEvent`
- Modify: `packages/domain/src/events.test.ts`
- Modify: `apps/web/src/sim/simulator.ts`, `apps/web/src/sim/officeStore.ts`, `apps/web/src/sim/simulator.test.ts`

**Interfaces:**
- Consumes: các union trạng thái (Task 3), `AgentState`.
- Produces:
  ```ts
  export type EntityKind = 'agent'|'campaign'|'stage'|'task'|'review'|'artifact'|'approval'|'video_version'|'post'|'meeting'|'message'|'cli_run';
  export interface EventDataMap { /* đúng bảng TK2 mục 6.2, mỗi loại một kiểu data */ }
  export type EventType = keyof EventDataMap;
  export interface DomainEvent<T extends EventType = EventType> {
    seq: number; at: number; type: T; workspaceId: string; campaignId?: string;
    entity: { kind: EntityKind; id: string }; actor: Actor; data: EventDataMap[T];
  }
  export interface ClientState { lastSeq: number; needsResync: boolean; agents: Readonly<Record<string, AgentStatus>> }
  export interface AgentStatus { state: AgentState; since: number; taskId?: string }
  export const emptyClientState: ClientState;
  export function applyEvent(s: ClientState, e: DomainEvent): ClientState;
  export function applySnapshot(s: ClientState, snap: { seq: number; agents: Record<string, AgentStatus> }): ClientState;
  ```
- `applyEvent`: bỏ sự kiện `seq <= lastSeq` (trả nguyên `s`); hở `seq` → `needsResync: true`; mọi loại sự kiện đều cập nhật `lastSeq`; chỉ `agent.state_changed` đổi `agents` (theo `entity.id`). Giữ ngữ nghĩa `applySnapshot` hiện có.
- `EventDataMap['agent.state_changed'] = { state: AgentState; taskId?: string; cliRunId?: string; meetingId?: string }`.
- `cli_run.output` **không** nằm trong `EventDataMap` (kênh riêng, không `seq`).
- S4: `FakeEventBus.emit` tạo `DomainEvent<'agent.state_changed'>` với `workspaceId: 'spike'`, `actor: 'system'`, `entity: { kind: 'agent', id }`. Mô tả task giả lập (chuỗi tiếng Việt) không đưa vào `data.taskId` (đó là id thật) mà lưu trong `Map<agentId, string>` `taskLabels` của `officeStore`; `AgentPanel` đọc từ đó.

- [ ] **Step 1: Viết test thất bại** — sửa `events.test.ts`: các test cũ chuyển sang `DomainEvent` (tạo bằng helper `agentEvent(seq, id, state)` trong test); thêm: sự kiện `task.status_changed` với `seq` kế tiếp → `lastSeq` tăng, `agents` giữ nguyên; tham chiếu kiểu: `const e: DomainEvent<'post.status_changed'> = {…, data: { from: 'scheduled', to: 'publishing', platform: 'tiktok' }}` biên dịch được.
- [ ] **Step 2:** `pnpm test packages/domain` → FAIL.
- [ ] **Step 3:** Cài đặt `events.ts`; sửa S4 (`simulator.ts`, `officeStore.ts`, `simulator.test.ts`; `AgentPanel.tsx` đọc `taskLabel` nếu đổi).
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm build` → tất cả PASS; mở `pnpm dev` thấy nhân vật vẫn đổi trạng thái (sự kiện/giây > 0).
- [ ] **Step 5: Commit** — `feat(domain): domain events and client reducer; spike uses agent.state_changed`
