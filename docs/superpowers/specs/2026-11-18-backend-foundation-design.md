# Backend phần 1 — Nền dữ liệu (apps/server)

Ngày: 2026-11-18. Phần 1/4 của backend (thứ tự người dùng đồng ý 2026-11-18: nền dữ liệu → chạy Agent → luồng Campaign đầu
tiên → nối văn phòng 3D). Dựa trên TK1–TK4 (`docs/design/`), D-8, D-10, D-14, D-16.

## Mục đích

Có một server cục bộ lưu dữ liệu theo TK1, đổi trạng thái **chỉ** qua `transition()` (ghi bản ghi + sự kiện + nhật ký trong
cùng giao dịch, TK2/TK3), và phát sự kiện qua SSE để UI/3D đọc. Phần 2–4 xây trên nền này.

## Mục tiêu

- `apps/server`: Hono + `@hono/node-server`, chỉ nghe `127.0.0.1` (ứng dụng cục bộ một người dùng, D-8).
- SQLite qua Drizzle ORM; migration SQL sinh bằng drizzle-kit, áp tự động khi khởi động.
- Bảng cho phần 1–3: `workspaces`, `agents`, `campaigns`, `campaign_stages`, `assets`, `tasks`, `reviews`, `artifacts`,
  `approvals`, `conversations`, `messages`, `meetings`, `cli_runs`, `events`, `audit`.
- `transition()` và `emit()` (sự kiện không đổi trạng thái, vd. `task.created`) dùng state machine của `packages/domain`.
- Trạng thái Agent: dựng `AgentFacts` từ DB, gọi `deriveAgentState`, phát `agent.state_changed` khi đổi — trong cùng giao dịch.
- Event Bus: `GET /events` (SSE, nối tiếp bằng `Last-Event-ID`/`?after=`), `GET /snapshot`, dọn sự kiện cũ (90 ngày; `agent.state_changed` 30 ngày).
- Khởi tạo lần đầu: một Workspace mặc định với Director, Coordinator và vài Agent chuyên môn (đủ cho văn phòng 3D).

## Không làm (phần sau)

CLI Harness, MCP, bộ xếp lịch (phần 2); API chat/brief/duyệt (phần 3); nối 3D (phần 4); bảng video, đăng bài, mạng xã hội,
bộ nhớ (chờ S2/S3 và TK4 khi cần).

## Hướng đã chọn

| Câu hỏi | Chọn | Bị loại |
|---|---|---|
| Web framework | **Hono** (D-16) | Fastify |
| Driver SQLite | **`better-sqlite3`** + Drizzle 0.45 (bản ổn định). Có FTS5 cho TK4 | `node:sqlite` + Drizzle 1.0 beta: driver chỉ có ở bản beta, rủi ro cho phần lưu dữ liệu cốt lõi |
| Truyền sự kiện | **SSE** (TK2 mục 6.3) | WebSocket |

Mọi thư viện mới đều miễn phí: hono (MIT), @hono/node-server (MIT), drizzle-orm (Apache-2.0), drizzle-kit (MIT),
better-sqlite3 (MIT), ulid (MIT) — D-14.

## Thiết kế

- **Thư mục dữ liệu** *(đề xuất)*: biến `DELE_DATA_DIR`, mặc định `~/Library/Application Support/DeleBanana/`; tệp `db.sqlite`.
  Kiểm thử dùng SQLite trong bộ nhớ.
- **Giao dịch**: `better-sqlite3` đồng bộ, nên `transition()` chạy trong `db.transaction(...)`; sau khi commit mới đẩy sự kiện
  cho các kết nối SSE (không phát sự kiện của giao dịch bị huỷ).
- **`transition(tx, { entity, id, to, actor, ctx?, data? })`**: đọc trạng thái hiện tại → `checkTransition` → cập nhật cột `status`
  → ghi `events` → ghi `audit` (`action = <entity>.transition`) → tính lại trạng thái Agent bị ảnh hưởng. Sai đường chuyển: ném lỗi,
  giao dịch huỷ, ghi `audit` `denied` ở giao dịch riêng.
- **Agent bị ảnh hưởng**: người được giao task, người yêu cầu Approval, người tham gia Meeting, người có CliRun liên quan.
- **SSE**: mỗi kết nối nhận sự kiện `seq > after`; nếu `after` nhỏ hơn sự kiện cũ nhất còn giữ → trả sự kiện `resync` để client lấy snapshot.
- **Che bí mật** trong `audit.details` theo TK3 mục 8 (lọc khoá `token`, `secret`, `authorization`, `key`, `password`, `cookie`).

## Để lại cho người dựng

Tên cột cụ thể, chỉ mục, cổng mặc định (đề xuất 8787), cấu trúc thư mục trong `apps/server/src`.
