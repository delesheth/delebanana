# Backend foundation (apps/server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server cục bộ Hono + SQLite: lưu dữ liệu TK1, đổi trạng thái chỉ qua `transition()` (bản ghi + sự kiện + nhật ký cùng giao dịch), tính lại trạng thái Agent, phát sự kiện qua SSE.

**Architecture:** `apps/server` dùng Drizzle 0.45 trên better-sqlite3 (đồng bộ). Một "đơn vị công việc" (`runTx`) gom sự kiện trong giao dịch và chỉ đẩy ra EventBus sau commit. HTTP chỉ có `/health`, `/snapshot`, `/events` (SSE) ở phần này.

**Tech Stack:** TypeScript 7, Node 22, Hono 4 + @hono/node-server 2, drizzle-orm 0.45 + drizzle-kit 0.31, better-sqlite3 13, ulid 3, vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-18-backend-foundation-design.md` (dựa trên `docs/design/01..04`).

## Global Constraints

- Chỉ nghe `127.0.0.1`; cổng mặc định 8787 (biến `PORT`).
- Thư mục dữ liệu: `DELE_DATA_DIR`, mặc định `~/Library/Application Support/DeleBanana/`, tệp `db.sqlite`; tự tạo nếu chưa có.
- Thư viện mới chỉ: hono, @hono/node-server, drizzle-orm, drizzle-kit (dev), better-sqlite3, @types/better-sqlite3 (dev), ulid. Không gì trả phí (D-14). Thêm `better-sqlite3: true` vào `allowBuilds` của `pnpm-workspace.yaml`.
- Mọi đổi cột `status` chỉ qua `UnitOfWork.transition`; dùng `checkTransition` của `@delebanana/domain`.
- Sự kiện chỉ đẩy ra EventBus **sau** commit; giao dịch lỗi không đẩy gì.
- `audit.details` che khoá chứa `token`, `secret`, `authorization`, `key`, `password`, `cookie` (không phân biệt hoa thường) thành `"[đã che]"`.
- Dọn sự kiện: giữ 90 ngày; `agent.state_changed` 30 ngày.
- Chú thích, thông báo lỗi tiếng Việt; import đuôi `.ts`; kiểm thử `pnpm test`, typecheck `pnpm typecheck`.
- Không commit (người dùng chưa cho phép); bước "Commit" = bỏ qua.

## Review Focus

- `transition` với id không tồn tại → lỗi rõ ràng, không sự kiện, không đổi dữ liệu. (Task 2)
- Lỗi ném ra giữa `runTx` sau khi đã `emit` → giao dịch huỷ, EventBus không nhận gì. (Task 2)
- SSE với `after` lớn hơn `seq` hiện tại, hoặc nhỏ hơn sự kiện cũ nhất còn giữ → gửi sự kiện `resync`. (Task 5)
- Hai kết nối SSE cùng lúc đều nhận cùng sự kiện. (Task 5)
- Tính lại trạng thái Agent hai lần liên tiếp không đổi → không phát sự kiện thứ hai. (Task 3)

---

### Task 1: Khung `apps/server`, kết nối DB, schema và migration

**Files:**
- Create: `apps/server/package.json` (`@delebanana/server`, `type: module`, scripts `dev: node --watch src/main.ts`, `typecheck: tsc -p .`, `db:generate: drizzle-kit generate`), `apps/server/tsconfig.json` (extends base, `types: ["node"]`), `apps/server/drizzle.config.ts` (dialect `sqlite`, schema `src/db/schema.ts`, out `drizzle`)
- Create: `apps/server/src/db/schema.ts`, `apps/server/src/db/client.ts`, `apps/server/src/ids.ts`
- Create: `apps/server/drizzle/*` (sinh bằng `pnpm --filter @delebanana/server db:generate`)
- Modify: `pnpm-workspace.yaml` (allowBuilds `better-sqlite3: true`)
- Test: `apps/server/src/db/client.test.ts`

**Interfaces:**
- Produces:
  - `schema.ts`: bảng `workspaces`, `agents`, `campaigns`, `campaignStages`, `assets`, `tasks`, `reviews`, `artifacts`, `approvals`, `conversations`, `messages`, `meetings`, `cliRuns`, `events`, `audit` theo TK1 (+ TK2 Meeting, TK3 AuditEntry). Cột JSON dùng `text({ mode: 'json' })`. Thời gian `integer` ms. Khoá ULID `text`.
    - Bổ sung so với TK1: `agents.lastState` (text, nullable) và `agents.lastStateAt` (integer) — bộ nhớ đệm trạng thái đã phát, không phải nguồn sự thật; `tasks.failureSeenAt` (integer, nullable) cho dòng 9 của TK2 mục 5; `messages.kind` gồm `question`.
    - `events.seq` `integer primaryKey autoIncrement`.
  - `client.ts`: `export type Db = BetterSQLite3Database<typeof schema>`; `openDb(file: string): Db` (`':memory:'` cho kiểm thử; bật `journal_mode = WAL`, `foreign_keys = ON`; chạy `migrate` từ thư mục `apps/server/drizzle` tìm theo `import.meta.url`); `defaultDataDir(): string`.
  - `ids.ts`: `newId(): string` (ulid).

- [ ] **Step 1: Viết test thất bại** — `openDb(':memory:')` rồi `PRAGMA table_list` (hoặc `sqlite_master`) chứa đủ 15 bảng trên; chạy `openDb` hai lần trên cùng tệp tạm không lỗi (migration idempotent); `newId()` trả chuỗi 26 ký tự, hai lần gọi khác nhau.
- [ ] **Step 2:** `pnpm test apps/server` → FAIL (chưa có module).
- [ ] **Step 3:** Thêm dependency (`pnpm --filter @delebanana/server add hono @hono/node-server drizzle-orm better-sqlite3 ulid @delebanana/domain@workspace:*`, dev `drizzle-kit @types/better-sqlite3 @types/node`), viết schema/client/ids, sinh migration.
- [ ] **Step 4:** `pnpm test apps/server && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — bỏ qua.

### Task 2: Đơn vị công việc — `transition`, `emit`, `audit`, EventBus

**Files:**
- Create: `apps/server/src/core/bus.ts`, `apps/server/src/core/unitOfWork.ts`, `apps/server/src/core/redact.ts`
- Test: `apps/server/src/core/unitOfWork.test.ts`, `apps/server/src/core/redact.test.ts`

**Interfaces:**
- Consumes: `Db`, bảng (Task 1); `checkTransition`, các machine, `DomainEvent`, `EventType`, `EventDataMap`, `Actor` (domain).
- Produces:
  ```ts
  export class EventBus { subscribe(fn: (e: DomainEvent) => void): () => void; publish(events: DomainEvent[]): void }
  export type TransitionEntity = 'campaign' | 'stage' | 'task' | 'approval';
  export interface TransitionInput { entity: TransitionEntity; id: string; to: string; actor: Actor; ctx?: unknown; data?: Record<string, unknown> }
  export interface EmitInput<T extends EventType> { type: T; workspaceId: string; campaignId?: string; entity: { kind: EntityKind; id: string }; actor: Actor; data: EventDataMap[T] }
  export interface AuditInput { workspaceId: string; campaignId?: string; actor: Actor; action: string; target?: { kind: string; id: string }; result: 'allowed' | 'denied' | 'failed'; reason?: string; cliRunId?: string; details?: unknown }
  export interface UnitOfWork { tx: Db; now: number; transition(i: TransitionInput): DomainEvent; emit<T extends EventType>(i: EmitInput<T>): DomainEvent<T>; audit(i: AuditInput): void; touchAgents(ids: string[]): void }
  export interface Deps { db: Db; bus: EventBus; clock?: () => number }
  export function runTx<T>(deps: Deps, fn: (u: UnitOfWork) => T): T;
  export function redact(value: unknown): unknown;
  ```
- `transition`: đọc bản ghi theo `entity` (`campaigns`/`campaignStages`/`tasks`/`approvals`), không có → ném `Error('<entity> <id> không tồn tại')`; `checkTransition(machine, from, to, actor, ctx)` sai → ghi `audit` `denied` **bằng giao dịch riêng sau khi huỷ** rồi ném lỗi với `reason`; đúng → cập nhật `status` (và `updatedAt`), ghi sự kiện `<entity>.status_changed` (stage: `stage.status_changed` kèm `stage`; task kèm `attempt`, `assigneeAgentId`; approval: `approval.decided` khi `to !== 'pending'`), ghi `audit` `allowed` với `action = '<entity>.transition'`, `touchAgents` các Agent liên quan (task: người được giao; approval: người yêu cầu).
- `runTx`: `db.transaction(tx => …)` đồng bộ; cuối giao dịch gọi hook tính lại Agent (Task 3 gắn vào qua `setAgentRecompute(fn)` export từ `unitOfWork.ts`, mặc định không làm gì); sau commit `bus.publish(events theo seq)`.
- `redact`: đệ quy object/array, khoá khớp `/token|secret|authorization|key|password|cookie/i` → `'[đã che]'`.

- [ ] **Step 1: Viết test thất bại:**
  - Task `queued` → `transition({entity:'task', to:'assigned', actor:'system', ctx:{attempt:1}})`: bản ghi `status = 'assigned'`, bảng `events` có 1 dòng `task.status_changed` `data.from='queued'`, `audit` có 1 dòng `allowed`, bus nhận đúng 1 sự kiện sau `runTx` trả về.
  - `transition` task `queued → done` → ném lỗi chứa `không có đường chuyển`; `status` vẫn `queued`; `events` rỗng; `audit` có 1 dòng `denied`; bus không nhận gì.
  - `transition` id lạ → ném `không tồn tại`, không sự kiện.
  - `runTx` gọi `emit(...)` rồi `throw` → `events` rỗng, bus không nhận gì.
  - Hai `emit` trong một `runTx` → `seq` liên tiếp, bus nhận theo thứ tự.
  - `redact({ accessToken: 'a', nested: [{ password: 'p', ok: 1 }] })` → `{ accessToken: '[đã che]', nested: [{ password: '[đã che]', ok: 1 }] }`; `audit` lưu `details` đã che.
- [ ] **Step 2:** `pnpm test apps/server/src/core` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** `pnpm test apps/server && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — bỏ qua.

### Task 3: Tính lại trạng thái Agent từ DB

**Files:**
- Create: `apps/server/src/core/agentState.ts`
- Test: `apps/server/src/core/agentState.test.ts`

**Interfaces:**
- Consumes: `UnitOfWork`, `setAgentRecompute` (Task 2); `deriveAgentState`, `AgentFacts` (domain).
- Produces:
  ```ts
  export function agentFacts(tx: Db, agentId: string): AgentFacts;
  export function recomputeAgents(u: UnitOfWork, agentIds: string[]): void; // đăng ký bằng setAgentRecompute khi import module
  ```
- `agentFacts`: `enabled` từ `agents.enabled`; `inMeeting` = có Meeting `endedAt IS NULL` chứa agentId trong `participantAgentIds`; `blocked` = `false` (phần 2); `activeRun` = CliRun `endedAt IS NULL` của Agent (purpose + kind của task nếu có); `runningTaskKind` = task `running` của Agent; `hasWaitingTask`, `hasAssignedTask` theo `tasks.status`; `awaitingUserReply` = Agent là director và Message cuối cùng của hội thoại Director trong Workspace là của chính Agent với `kind = 'question'`; `hasPendingApproval` = Approval `pending` có `requestedByAgentId = agentId`; `unseenFailure` = task `failed` của Agent có `failureSeenAt IS NULL`.
- `recomputeAgents`: với mỗi Agent, `deriveAgentState(agentFacts(...))`; khác `agents.lastState` → cập nhật `lastState`, `lastStateAt` và `emit('agent.state_changed', { state, taskId? })` (`entity: { kind: 'agent', id }`, `actor: 'system'`).

- [ ] **Step 1: Viết test thất bại** (seed tối thiểu trong test: workspace, agent researcher, campaign, task):
  - Task `queued → assigned` trong `runTx` → bus nhận thêm `agent.state_changed` với `data.state = 'assigned'` cho người được giao; `agents.lastState = 'assigned'`.
  - Gọi `runTx(u => recomputeAgents(u, [id]))` lần nữa không đổi gì → không có sự kiện mới.
  - Có CliRun mở `purpose = 'task'` cho task `research.trend` → `agentFacts(...).activeRun` đúng và trạng thái `researching`.
  - Director có Message cuối `kind='question'` → `awaitingUserReply = true`; thêm Message của user sau đó → `false`.
  - Agent `enabled = false` → `offline`.
- [ ] **Step 2:** `pnpm test apps/server/src/core/agentState.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — bỏ qua.

### Task 4: Khởi tạo dữ liệu, snapshot, dọn sự kiện

**Files:**
- Create: `apps/server/src/core/seed.ts`, `apps/server/src/core/snapshot.ts`, `apps/server/src/core/prune.ts`
- Test: `apps/server/src/core/seed.test.ts`

**Interfaces:**
- Consumes: `runTx`, `recomputeAgents`, `Db`, `ClientSnapshot` (domain).
- Produces:
  ```ts
  export const DEFAULT_ROSTER: { name: string; role: AgentRole; title: string }[]; // Linh director, Minh coordinator, An researcher "Trend Researcher", Chi researcher "Competitor Researcher", Bình creative, Hà scriptwriter
  export function seedIfEmpty(deps: Deps): { workspaceId: string; created: boolean };
  export function snapshot(db: Db): ClientSnapshot & { workspaces: { id: string; name: string }[]; roster: { id: string; name: string; role: AgentRole; title: string }[] };
  export function pruneEvents(db: Db, now: number): number; // trả số dòng đã xoá
  ```
- `seedIfEmpty`: chỉ khi chưa có Workspace: tạo Workspace "Dele Banana", 6 Agent theo `DEFAULT_ROSTER` (provider `claude`, model `sonnet` — D-15; quyền mặc định theo TK3 mục 5), một Conversation Director; `recomputeAgents` → mỗi Agent một `agent.state_changed` `idle`.
- `snapshot`: `seq` = `max(events.seq)` (0 nếu rỗng); `agents` = `{ [id]: { state: lastState ?? 'offline', since: lastStateAt ?? 0 } }`.
- `pruneEvents`: xoá `agent.state_changed` cũ hơn 30 ngày và loại khác cũ hơn 90 ngày (theo `at`).

- [ ] **Step 1: Viết test thất bại:**
  - `seedIfEmpty` lần 1 → `created: true`, 6 Agent đúng tên/vai trò, đúng 1 Director và 1 Coordinator, 6 sự kiện `agent.state_changed` `idle`; lần 2 → `created: false`, không thêm gì.
  - `snapshot` sau seed: `seq` bằng `seq` lớn nhất, 6 Agent `idle`, `roster` 6 dòng.
  - `pruneEvents(db, now)` với 3 sự kiện chèn tay: `agent.state_changed` 31 ngày (xoá), `task.status_changed` 31 ngày (giữ), `task.status_changed` 91 ngày (xoá) → trả `2`.
- [ ] **Step 2:** `pnpm test apps/server/src/core/seed.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — bỏ qua.

### Task 5: HTTP — `/health`, `/snapshot`, `/events` (SSE) và `main.ts`

**Files:**
- Create: `apps/server/src/http/app.ts`, `apps/server/src/main.ts`
- Modify: `package.json` gốc (script `server: pnpm --filter @delebanana/server dev`)
- Test: `apps/server/src/http/app.test.ts`

**Interfaces:**
- Consumes: `Deps`, `EventBus`, `snapshot`, bảng `events`.
- Produces:
  ```ts
  export function createApp(deps: Deps): Hono;
  ```
  - `GET /health` → `{ ok: true }`.
  - `GET /snapshot` → JSON của `snapshot(db)`.
  - `GET /events?after=<seq>` (hoặc header `Last-Event-ID`): `streamSSE`; nếu `after > maxSeq`, hoặc bảng `events` không rỗng và `after < minSeq - 1` (sự kiện cần đã bị dọn) → gửi một sự kiện SSE `event: resync` rồi đóng; ngược lại gửi mọi sự kiện `seq > after` theo thứ tự (`id: seq`, `event: <type>`, `data: JSON DomainEvent`), rồi đăng ký bus để gửi tiếp; huỷ đăng ký khi kết nối đóng. Gửi `event: ping` mỗi 25 s để giữ kết nối.
  - `main.ts`: `openDb(join(DELE_DATA_DIR, 'db.sqlite'))` (tạo thư mục nếu thiếu), `seedIfEmpty`, `pruneEvents` lúc khởi động và mỗi 24 giờ, `serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT ?? 8787 })`, in địa chỉ.

- [ ] **Step 1: Viết test thất bại** (dùng `app.request()`; đọc SSE bằng `res.body.getReader()` tới khi đủ số khối `\n\n` cần):
  - `/health` → 200 `{ ok: true }`.
  - `/snapshot` sau seed → 6 Agent, `seq > 0`.
  - `/events?after=0` → nhận đủ 6 sự kiện `agent.state_changed` với `id` tăng dần; sau đó `runTx` một `emit` mới → kết nối nhận thêm sự kiện đó.
  - Hai kết nối `/events?after=<seq hiện tại>` cùng nhận một sự kiện mới.
  - `/events?after=999999` → nhận `event: resync`.
  - Header `Last-Event-ID: 3` → chỉ nhận sự kiện `seq > 3`.
- [ ] **Step 2:** `pnpm test apps/server/src/http` → FAIL.
- [ ] **Step 3:** Cài đặt `app.ts`, `main.ts`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS; chạy `DELE_DATA_DIR=<thư mục tạm> pnpm server`, `curl -s localhost:8787/snapshot` thấy 6 Agent, `curl -N localhost:8787/events?after=0` thấy sự kiện; dừng server.
- [ ] **Step 5: Commit** — bỏ qua.
