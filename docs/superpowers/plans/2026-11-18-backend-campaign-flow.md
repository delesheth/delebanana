# Backend campaign flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luồng Campaign đầu tiên qua API: chat với Director → brief → bàn giao → Nghiên cứu → Kịch bản (3 bản) → người dùng chọn kịch bản.

**Architecture:** `apps/server/src/campaign/engine.ts` chạy luật bước (thuần backend, gọi trong `runTx`); Gateway thêm công cụ Director và luật "đúng 3 kịch bản"; Runtime thêm lượt `planning` (Coordinator), lượt `chat`/`briefing` (Director) và gọi `progressCampaign` mỗi `tick`; HTTP thêm route Campaign/hội thoại/Approval.

**Tech Stack:** như phần 1–2.

**Spec:** `docs/superpowers/specs/2026-11-18-backend-campaign-flow-design.md`

## Global Constraints

- Campaign MVP: `stages = ['research', 'scripting']`; 5 bản ghi CampaignStage theo `STAGE_ORDER`.
- Mọi đổi trạng thái qua `u.transition`; bước/Approval/Campaign dùng machine của `packages/domain` với đúng tác nhân (bàn giao: `agent:<director>`; bước: `system`; quyết định Approval: `user`).
- Chốt chống đốt hạn mức: 3 lượt `planning` rỗng liên tiếp/bước → ngừng + tin hệ thống; mỗi tin người dùng tối đa 2 lượt Director.
- Kịch bản: tối đa 3 task `script` chưa `failed`/`cancelled` trong một vòng của bước `scripting`; vòng mới bắt đầu khi bước quay lại `running` sau `changes_requested`/`rejected`.
- Kiểm thử không gọi Claude thật. Không thêm thư viện. Không commit. Không tốn thêm tiền (D-14).

## Review Focus

- Người dùng chọn artifact không thuộc 3 kịch bản của Approval → 400, không đổi gì. (Task 3)
- Quyết định Approval đã quyết rồi → 409, không đổi gì. (Task 3)
- Director gọi `campaign_handoff` khi brief thiếu → từ chối, Campaign vẫn `briefing`. (Task 2)
- Bàn giao hai lần / gọi `campaign_update_brief` khi Campaign đã `active` → từ chối. (Task 2)
- Tin người dùng gửi khi Director đang chạy → được xử lý ở lượt sau, không chạy song song. (Task 2)

---

### Task 1: Luật bước — `campaign/engine.ts`

**Files:** Create `apps/server/src/campaign/engine.ts`; Test `apps/server/src/campaign/engine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MVP_STAGES: StageName[]; // ['research', 'scripting']
  export function createCampaign(u: UnitOfWork, workspaceId: string, title: string): string; // id; briefing + 5 stage pending + campaign.created
  export function activateCampaign(u: UnitOfWork, campaignId: string, actor: Actor): void; // briefing→active (guard brief) ; stage ngoài list → skipped ; bước đầu → running ; currentStage
  export function progressCampaign(u: UnitOfWork, campaignId: string): void; // áp luật bước của spec, idempotent
  export function decideChooseScript(u: UnitOfWork, approvalId: string, status: 'approved' | 'rejected' | 'changes_requested', decision: { chosen?: string[]; note?: string }): void;
  export function currentRound(tx: DbLike, campaignId: string): number; // vòng hiện tại của bước scripting (số lần bước này vào running)
  ```
- `progressCampaign` (chỉ khi Campaign `active`, theo bước `currentStage`):
  - `research`: không còn task mở (`queued/assigned/running/waiting/in_review`), có ≥ 1 task nghiên cứu `done` và chưa có `research.synthesis` → tạo task synthesis (Coordinator của Workspace, `dependsOn` = các task nghiên cứu `done`, `task.created`); synthesis `done` → bước `done` → `advance`.
  - `scripting`: 3 task `script` `done` trong vòng hiện tại và chưa có Approval `choose_script` `pending` → bước `awaiting_approval`, Approval `choose_script` (`subject = { kind: 'artifact', ids: [3 artifact script mới nhất của 3 task] , round }`, `requestedByAgentId` = Director) + `approval.requested` + tin hệ thống cho Director ("3 kịch bản đã sẵn sàng…").
  - Bước không còn task mở, có task `failed`, và không thể tiến → tin hệ thống một lần (lưu `campaign_stages.summary = 'stuck'` để không lặp).
  - `advance`: bước kế trong `stages` → `running` + `currentStage`; hết bước → Campaign `active → completed`.
- `decideChooseScript`: Approval phải `pending` và `kind = choose_script` (sai → ném `ApprovalError` mã 409); `approved` cần `chosen` ⊆ `subject.ids`, ≥ 1 (sai → mã 400); `approved` → Approval `approved`, bước `awaiting_approval → done`, `advance`; còn lại → Approval theo `status`, bước `awaiting_approval → running` (`summary = note` để prompt planning đọc).
- Vòng (`round`): đếm sự kiện `stage.status_changed` của bước scripting có `to = 'running'` (bắt đầu 1).

- [ ] **Step 1: Test thất bại:** tạo Campaign → 5 bước pending, `briefing`; bàn giao brief thiếu → lỗi, vẫn `briefing`; brief đủ → `active`, research `running`, video/publishing/analytics `skipped`; 2 task nghiên cứu `done` → `progress` tạo đúng 1 synthesis (gọi 2 lần vẫn 1); synthesis `done` → research `done`, scripting `running`; 3 script `done` (kèm artifact) → `awaiting_approval` + 1 Approval `choose_script` với 3 id; `decideChooseScript` approved `chosen` 1 id → bước done → Campaign `completed`; chosen id lạ → lỗi 400, không đổi; quyết định lần 2 → 409; `changes_requested` → bước `running`, `currentRound` = 2; task failed và hết task mở → 1 tin hệ thống (gọi lại không thêm).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** `pnpm test && pnpm typecheck` → PASS.

### Task 2: Công cụ Director, lượt planning/chat trong Runtime

**Files:** Modify `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/prompts.ts`, `apps/server/src/agents/runtime.ts`; Test `apps/server/src/agents/director.test.ts`, bổ sung `runtime.test.ts`

**Interfaces:**
- Consumes: `activateCampaign`, `progressCampaign`, `currentRound` (Task 1).
- Produces (gateway): `PURPOSE_TOOLS.chat = ['user_reply', 'user_ask']`, `PURPOSE_TOOLS.briefing = ['user_reply', 'user_ask', 'campaign_update_brief', 'campaign_handoff']`; `TOOL_CAPABILITY`: `user_reply`/`user_ask` → `user.converse`, `campaign_update_brief`/`campaign_handoff` → `campaign.brief.write`.
  - `user_reply`/`user_ask`: Message vào hội thoại Director (`role: 'agent'`, `kind: 'chat' | 'question'`, `campaignId` của binding nếu có) + `message.created`; đặt `binding.submitted = true` (dùng làm "đã trả lời").
  - `campaign_update_brief`: Campaign cùng Workspace, đang `briefing` (khác → lỗi); gộp trường vào `brief`.
  - `campaign_handoff`: `activateCampaign(u, id, 'agent:<director>')`.
  - `task_create` khi bước `scripting`: kind `script` thứ 4 còn mở/`done` trong vòng hiện tại → lỗi "Đã đủ 3 kịch bản".
  - Binding thêm trường tuỳ chọn `conversationId`.
- Produces (prompts): `directorPrompt({ messages, campaigns })`, `planningPrompt({ campaign, stage, round, note?, previous: { title, content }[] })`.
- Runtime `tick()` thứ tự: (0) `progressCampaign` cho mọi Campaign `active` (mỗi Campaign một `runTx`); (1) Director: tin cuối hội thoại là của `user`, chưa vượt 2 lượt cho tin đó (theo id tin, trong bộ nhớ), Director rảnh → lượt `briefing` (nếu có Campaign `briefing` trong Workspace, binding gắn Campaign briefing mới nhất) hoặc `chat`; (2) review như cũ; (3) planning: Campaign `active`, bước hiện tại `running`, không có task nào của bước ở trạng thái mở, chưa vượt 3 lượt planning rỗng (khoá = campaign + stage + round) → lượt `planning` cho Coordinator; (4) task như cũ.
- Lượt Director/planning kết thúc: đóng CliRun, `blockOnOutcome`, cập nhật bộ đếm chốt chặn (planning "rỗng" = không tạo task nào).

- [ ] **Step 1: Test thất bại** (harness giả gọi công cụ):
  - Tin người dùng → `tick` chạy 1 lượt `briefing` của Director; harness gọi `campaign_update_brief` đủ trường rồi `campaign_handoff` + `user_reply` → Campaign `active`, có Message trả lời.
  - `campaign_handoff` khi brief thiếu → lỗi, Campaign `briefing`; `campaign_update_brief` khi `active` → lỗi.
  - Director đang chạy (harness treo) + tin mới → `tick` không chạy lượt Director thứ hai.
  - Director không trả lời 2 lần cho cùng tin → lần 3 không chạy.
  - Campaign `active`, research `running`, không task → `tick` chạy lượt `planning` của Coordinator với `tools/list` = `task_create`; harness tạo 2 task → các `tick` sau giao task.
  - 3 lượt planning rỗng → lượt 4 không chạy, có tin hệ thống.
  - `task_create` script thứ 4 → lỗi.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS.

### Task 3: HTTP API và quyết định Approval

**Files:** Create `apps/server/src/http/api.ts` (mount trong `createApp`), `apps/server/src/campaign/approvals.ts`; Test `apps/server/src/http/api.test.ts`

**Interfaces:**
- Consumes: `createCampaign`, `decideChooseScript`, `Gateway` (chạy lại lời gọi), `unblockProvider`.
- Produces:
  ```ts
  export function decideApproval(deps: Deps, gateway: Gateway | undefined, id: string, input: { status: string; decision?: Record<string, unknown> }): { ok: true } ; // ném ApprovalError(code 400|404|409)
  export function mountApi(app: Hono, deps: Deps, gateway?: Gateway): void;
  ```
  - `Gateway.runAs(agentId, campaignId, tool, args): string` — chạy lại lời gọi đã lưu với binding tạm (`purpose` = mục đích cho phép công cụ đó), vẫn qua kiểm năng lực/phạm vi/vòng đời; trả thông điệp hoặc ném lỗi.
  - `out_of_permission` approved: `grant = 'permanent'` → thêm năng lực vào Agent; rồi `runAs`; lỗi khi chạy lại → vẫn approved, ghi audit `failed` và tin hệ thống.
  - Routes như spec; lỗi `ApprovalError` → JSON `{ error }` với mã tương ứng; body sai → 400.
  - `GET /campaigns/:id` → `{ campaign, stages, tasks, artifacts, approvals }`.
  - `POST /conversations/director/messages` → Message `role: 'user'`, `kind: 'chat'` + `message.created`; trả `{ id }`.
- [ ] **Step 1: Test thất bại:** tạo Campaign qua API → 201, `GET /campaigns` có nó; gửi tin → có trong `GET /conversations/director/messages`; quyết định `choose_script` qua API (dựng Approval bằng engine) → 200, bước done; artifact lạ → 400; quyết lần 2 → 409; id lạ → 404; `out_of_permission` `permanent` cho `task_create` → Agent có năng lực, task được tạo; `POST /providers/claude/unblock` → hết khoá; body không phải JSON → 400.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS.

### Task 4: Kiểm tra cuối

- [ ] `pnpm test && pnpm typecheck && pnpm build` → PASS.
- [ ] Chạy server với dữ liệu tạm, gọi API bằng `curl` (tạo Campaign, gửi tin) **không chạy Claude thật** (`DELE_CLAUDE_BIN` trỏ CLI giả kịch bản `ok`): thấy lượt Director được tạo và đóng. Chạy thật bằng Claude để người dùng quyết (tốn hạn mức).
