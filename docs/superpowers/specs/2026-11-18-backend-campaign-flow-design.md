# Backend phần 3 — Luồng Campaign đầu tiên (chat → brief → Nghiên cứu → Kịch bản → chọn kịch bản)

Ngày: 2026-11-18. Phần 3/4. Dựa trên phần 1–2, TK1 (khung 5 bước), TK2 (vòng đời), TK3 (công cụ, duyệt), D-1, D-2, D-15, D-17.

## Mục đích

Người dùng chat với Director; Director làm rõ brief rồi bàn giao; Coordinator tự lên kế hoạch từng bước; đội nghiên cứu,
brainstorm, viết **3 kịch bản**; người dùng chọn kịch bản. Tất cả qua API JSON (UI ở phần sau). Bước Video/Đăng/Phân tích chưa có
(chờ S2/S3) nên Campaign của MVP gồm `research` và `scripting`.

## Luật bước (máy trạng thái bước của TK2, do backend chạy)

- **Tạo Campaign** (`POST /campaigns`): `briefing`, `stages = ['research','scripting']`, 5 bản ghi CampaignStage (`pending`).
- **Bàn giao** (công cụ `campaign_handoff` của Director): `briefing → active` (guard `isBriefComplete`); bước ngoài `stages` → `skipped`;
  bước đầu → `running`.
- **Bước đang chạy chưa có task mở** → bộ xếp lịch chạy một lượt **`planning`** cho Coordinator (công cụ `task_create`).
  Chặn vòng lặp: 3 lượt planning liên tiếp không tạo task → ngừng, báo Director (như chốt review).
- **research**: khi mọi task nghiên cứu `done` → backend tự tạo task `research.synthesis` cho Coordinator (phụ thuộc mọi task đó);
  synthesis `done` → bước `done` (không có điểm duyệt).
- **scripting**: Coordinator tạo `ideation` (Creative) và **đúng 3** task `script` (Scriptwriter; `task_create` từ chối task `script` thứ 4
  còn mở). Khi 3 task `script` `done` → bước `awaiting_approval`, tạo Approval `choose_script` (`subject.ids` = 3 artifact kịch bản,
  `requestedByAgentId` = Director) và tin hệ thống trong hội thoại Director.
- **Quyết định `choose_script`** (`POST /approvals/:id/decide`): `approved` với `decision.chosen` ⊆ 3 artifact (≥ 1) → bước `done`;
  `changes_requested`/`rejected` (kèm ghi chú) → bước `running`, task `script` cũ giữ lịch sử, Coordinator lên kế hoạch lại (ghi chú đưa vào prompt).
- **Bước cuối `done`** → Campaign `completed`. Task `failed` mà bước không còn task mở → tin hệ thống cho Director (không tự làm gì thêm).

## Director

- Hội thoại Director (một mỗi Workspace). `POST /conversations/director/messages { content, campaignId? }` lưu tin người dùng.
- Tin cuối của hội thoại là của người dùng và Director rảnh → lượt **`briefing`** (có Campaign `briefing`) hoặc **`chat`**.
  Mỗi tin người dùng được xử lý tối đa 2 lượt (không trả lời thì thôi, tránh đốt hạn mức).
- Công cụ Director: `user_reply { text }`, `user_ask { question }` (Message `question` → `awaiting_user_reply`),
  `campaign_update_brief { campaign_id, goal?, audience?, product?, platforms?, notes? }` (chỉ khi `briefing`),
  `campaign_handoff { campaign_id }`. Năng lực: `user.converse`, `campaign.brief.write` (TK3).
- Prompt Director: 20 tin gần nhất + danh sách Campaign (tiêu đề, trạng thái, brief, bước hiện tại, Approval đang chờ).

## Approval do người dùng quyết

`POST /approvals/:id/decide { status: 'approved' | 'rejected' | 'changes_requested', decision? }`:
- `choose_script`: như trên.
- `out_of_permission`: `decision.grant = 'once' | 'permanent'`; `permanent` thêm năng lực vào Agent; cả hai chạy lại lời gọi công cụ đã lưu
  (qua cùng đường kiểm phạm vi/vòng đời của Gateway, tác nhân là Agent). Từ chối: không làm gì.
- Mọi quyết định ghi nhật ký `user.approval.decide`.

## API (JSON, chỉ 127.0.0.1)

`GET /campaigns`, `POST /campaigns { title }`, `GET /campaigns/:id` (bước, task, artifact, approval),
`GET /conversations/director/messages?limit=`, `POST /conversations/director/messages`, `GET /approvals?status=pending`,
`POST /approvals/:id/decide`, `POST /providers/:provider/unblock` (mở khoá sau overage, TK3).

## Không làm

UI, bước video/đăng/phân tích, họp nhiều Agent (cơ chế đã thử ở S5; thêm sau), bộ nhớ (TK4), sửa task `failed` thủ công.

## Để lại cho người dựng

Chuỗi prompt, thứ tự kiểm tra trong `progress`, định dạng JSON trả về chi tiết.
