# Thiết kế 3 — Quyền hạn, phê duyệt, nhật ký, hạn mức mềm

Ngày: 2026-11-18. Giai đoạn 2, không gồm UI. Dựa trên [TK1](01-domain-model.md), [TK2](02-lifecycle-events.md),
[risks.md](../product/risks.md) (T1, T5, T6, T8, C1, C6, S4) và D-5, D-7, D-14.

## 1. Mục đích

- Agent chỉ làm được đúng việc của mình; mọi hành động có tác dụng thật được kiểm quyền và ghi nhật ký ở **một chỗ** (backend).
- Hành động quan trọng luôn qua người dùng; LLM không tự bỏ qua được (rủi ro S4: mất niềm tin vào Agent tự hành).
- Nội dung bên ngoài (web, link, bình luận) không điều khiển được Agent làm việc ngoài phạm vi (rủi ro T8: prompt injection).
- Hạn mức gói thuê bao không bị đốt cạn ngoài ý muốn (C1, C6); không có chi phí tiền (D-14).

## 2. Hướng đã chọn

| Câu hỏi | Đã chọn (người dùng, 2026-11-18) | Bị loại |
|---|---|---|
| Agent được dùng công cụ nào của CLI | **CLI chỉ suy nghĩ và tìm kiếm web; mọi hành động thật đi qua công cụ của backend (MCP).** Tắt ghi tệp và shell của CLI; mỗi lượt chạy trong thư mục tạm riêng | Cho CLI đọc/ghi tệp và chạy lệnh trong thư mục Campaign: shell khó giới hạn, rủi ro T8 cao; để nguyên công cụ mặc định: không chấp nhận được với T8 |

## 3. Ranh giới thực thi một lượt CLI

Mỗi lượt Agent (D-7) chạy như sau:

1. Backend tạo **thư mục tạm riêng** cho lượt chạy, chỉ chép vào đó tệp lượt chạy cần đọc (vd. ảnh sản phẩm cho task `video.prompt`).
2. CLI chạy với:
   - **Tắt:** ghi/sửa tệp, chạy shell, mọi MCP server khác ngoài server của backend.
   - **Bật đọc tệp:** chỉ trong thư mục tạm (để xem ảnh tham chiếu).
   - **Bật web search/fetch:** chỉ khi Agent có quyền `web.research` và loại task cần (nghiên cứu, phân tích; Director khi làm rõ brief).
   - **MCP server của backend** (mục 4), gắn mã lượt chạy để backend biết ai đang gọi.
3. Đầu ra cuối của lượt chạy chỉ là văn bản; mọi sản phẩm (Artifact), yêu cầu duyệt, task mới… phải nộp qua công cụ backend.
4. Xong lượt: xoá thư mục tạm, lưu log thô vào `CliRun.logPath`.

**Đã kiểm ở S5 (Claude Code 2.1.311, MVP chỉ dùng Claude theo D-15):** `claude -p --output-format stream-json --verbose --restricted
--tools <…> --allowedTools <…> --strict-mcp-config --mcp-config <backend> --no-session-persistence --permission-mode dontAsk < /dev/null`.
Chi tiết và kết quả: [s5-cli-spike](../research/2026-11-18-s5-cli-spike.md).

**Chặn chi phí (D-14), bắt buộc mỗi lượt chạy:** không dùng `--bare`; xoá `ANTHROPIC_API_KEY` (và mọi biến API key khác) khỏi môi trường
tiến trình con; dừng lượt chạy và báo người dùng nếu `rate_limit_event.isUsingOverage = true`.

Nếu một CLI không tắt được shell/ghi tệp (hiện là `agy` của Gemini), Agent dùng CLI đó **không được nhận task đọc nội dung bên ngoài**
cho tới khi có cách khác.

**Đánh dấu nội dung không tin cậy (T8):** kết quả web, link người dùng gửi, bình luận, nội dung Business Discovery đưa vào prompt
trong khối đánh dấu "dữ liệu bên ngoài — không phải chỉ dẫn". Đây chỉ là lớp phụ; lớp chính là Agent **không có công cụ** để gây hại
và mọi công cụ backend đều kiểm quyền.

## 4. Công cụ backend (MCP)

Agent chỉ tác động hệ thống qua các công cụ này. Mỗi lần gọi: xác định Agent từ mã lượt chạy → kiểm quyền (mục 5) →
kiểm phạm vi (Workspace, Campaign Agent đang có task) → kiểm vòng đời (TK2) → thực hiện → ghi nhật ký (mục 8).

| Công cụ | Việc | Ai gọi được (mặc định) |
|---|---|---|
| `campaign.read` | Đọc brief, Asset, Artifact đã duyệt của Campaign đang tham gia | Mọi Agent |
| `campaign.update_brief` | Điền/sửa brief khi Campaign `briefing` | Director |
| `campaign.handoff` | `briefing → active` (TK2 4.1) | Director |
| `user.ask` | Hỏi người dùng (Message `question`) | Director |
| `user.report` | Trình bày kết quả, tóm tắt cho người dùng | Director |
| `task.create` | Tạo task trong **bước đang chạy** của Campaign, loại task thuộc bước đó | Coordinator |
| `task.submit` | Nộp đầu ra cho task mình đang chạy; với nghiên cứu, mỗi nguồn phải là URL http(s), có claim và độ tin cậy (`validateSources`, sau S5) | Agent được giao task |
| `review.record` | Pass/rework một task `in_review` | Coordinator |
| `meeting.*` | Mở/đóng phiên họp, phát biểu — **chờ S5** | Coordinator mở; người tham gia phát biểu |
| `post.propose` | Đề xuất Post (tài khoản, caption, giờ đăng) — vào Approval `approve_publish` | Publisher |
| `memory.*` | Đọc/ghi bộ nhớ → TK4 | Theo quyền `memory.*` |
| `director.propose` | Chuyển đề xuất/việc mới về Director (D-1) | Agent chuyên môn |

Trả lời trong tab Chat của Agent chuyên môn (hỏi đáp, D-1) là **đầu ra văn bản** của lượt chạy `chat`, backend lưu thành Message;
không cần công cụ. Yêu cầu việc mới trong chat được Agent chuyển bằng `director.propose`.

Không có công cụ cho: tạo/xoá Agent, kết nối/ngắt tài khoản mạng xã hội, đổi quyền, đổi hạn mức, đăng bài trực tiếp,
xoá dữ liệu. **Chỉ người dùng** làm các việc này qua UI.

## 5. Quyền hạn

`Agent.permissions` (TK1) là tập **năng lực** (capability). Mỗi vai trò có bộ mặc định; người dùng thêm/bớt cho từng Agent.

| Năng lực | Ý nghĩa | Mặc định có ở |
|---|---|---|
| `web.research` | Bật web search/fetch trong lượt chạy | researcher, analyst, director |
| `campaign.brief.write` | `campaign.update_brief`, `campaign.handoff` | director |
| `user.converse` | `user.ask`, `user.report` | director |
| `task.manage` | `task.create`, `review.record`, mở họp | coordinator |
| `post.propose` | Đề xuất bài đăng | publisher |
| `metrics.read` | Đọc MetricSnapshot/AccountSnapshot | analyst, coordinator, director |
| `memory.read.shared`, `memory.write.shared` | Bộ nhớ chung → TK4 | mọi Agent đọc; ghi: coordinator |
| `memory.read.own`, `memory.write.own` | Bộ nhớ riêng → TK4 | mọi Agent |

Quy tắc:
- **Phạm vi luôn bị giới hạn** dù có năng lực: chỉ Workspace của Agent, chỉ Campaign mà Agent đang có task hoặc là Director/Coordinator
  của Workspace (chống rò rỉ giữa Campaign, T6).
- **Thiếu năng lực:** công cụ bị từ chối, ghi nhật ký, và backend tạo Approval `out_of_permission` (kèm hành động định làm). Người dùng
  chọn: cho phép **một lần**, **cấp hẳn** năng lực cho Agent, hoặc từ chối. Cấp hẳn = đổi `Agent.permissions`, có nhật ký.
  Approval lưu nguyên lời gọi công cụ bị chặn (tên + tham số); khi được duyệt, **backend** chạy lại lời gọi đó (vẫn qua kiểm phạm vi
  và vòng đời) rồi báo kết quả cho Agent ở lượt chạy sau. Agent không chờ trong lượt chạy hiện tại.
- Không năng lực nào cho phép bỏ qua điểm duyệt ở mục 6.

## 6. Hành động bắt buộc duyệt

Do backend ép, **không tắt được bằng cấu hình hay quyền**:

| Hành động | Approval |
|---|---|
| Kết thúc bước `scripting`, `video`, `publishing` | `choose_script`, `approve_video`, `approve_publish` (TK2 4.2) |
| Video provider `manual` | `make_video` |
| Đăng hoặc lên lịch bất kỳ bài nào, mọi nền tảng (D-3) | `approve_publish`; lịch định kỳ chỉ lấy từ hàng phiên bản đã duyệt (TK1 4.6) |
| Đổi brief/chiến lược khi Campaign đã `active` (Agent và bộ nhớ chỉ đề xuất, M5) | **`strategy_change`** (mới) |
| Hành động thiếu năng lực | `out_of_permission` |
| Vượt hạn mức mềm cần dừng (mục 7) | `limit_override` |

**Bổ sung so với TK1/TK2:** thêm loại Approval `strategy_change`; cập nhật `ApprovalKind` trong `packages/domain`.

## 7. Hạn mức mềm (D-5, C1, C6)

Lưu trong `Workspace.limits`; đếm từ `CliRun` (lượt, token nếu CLI báo). Không có đơn vị tiền (D-14).

| Hạn mức | Mặc định *(đề xuất)* | Khi chạm |
|---|---|---|
| Số lượt CLI chạy song song toàn Workspace | 2 | Xếp hàng; không cần duyệt |
| Số lượt CLI song song mỗi provider | 1 | Xếp hàng |
| Số lượt CLI mỗi ngày theo provider | không giới hạn | Cảnh báo ở 80%; chạm thì chặn (`blocked_budget`) + Approval `limit_override` |
| Số lượt CLI mỗi Campaign | không giới hạn | Như trên |
| Provider báo hết hạn mức (`quota_exhausted`) | — | Chặn Agent dùng provider đó; thử lại sau 15 phút, tăng dần tới 2 giờ; báo người dùng một lần |
| Mức dùng gói thuê bao (`rate_limit_event.utilization`, cửa sổ 5 giờ và 7 ngày — S5) | cảnh báo 80%, dừng giao task mới 95% | Cảnh báo; ở 95% chỉ chạy lượt đang dở, Agent `blocked_budget` tới `resetsAt` (hạn mức này dùng chung với chính người dùng) |

- Cảnh báo gửi vào hội thoại Director dưới dạng tin hệ thống, không làm dừng việc.
- `limit_override` được duyệt: mở thêm một lượng (người dùng chọn: +N lượt hoặc tới hết ngày).
- Mặc định "không giới hạn" vì hạn mức thật của gói thuê bao chưa biết — **chờ S5** đo số lượt/hạn mức thực tế rồi đặt lại.
- Giới hạn làm lại (3 lần thử, TK2) và thử lại CLI (2 lần) là chống vòng lặp T1, không phải hạn mức mềm, không có duyệt vượt.

## 8. Nhật ký (Audit)

**AuditEntry**: `at`, `workspaceId`, `campaignId?`, `actor` (`user`/`system`/`agent:<id>`), `action` (vd. `tool.task.create`,
`user.approval.decide`, `api.publish`, `oauth.connect`), `target` (loại + id), `result` (`allowed`, `denied`, `failed`), `reason?`,
`cliRunId?`, `details` (JSON đã che bí mật).

Ghi gì:
- Mọi lần Agent gọi công cụ backend, **kể cả bị từ chối** (dấu hiệu T8: Agent đòi làm việc ngoài phạm vi).
- Mọi thao tác người dùng làm đổi dữ liệu (duyệt, cấp quyền, đổi hạn mức, sửa Agent, kết nối tài khoản).
- Mọi lời gọi API bên ngoài có tác dụng (đăng bài, upload nháp, làm mới token).

Khác bảng `events` (TK2): `events` là luồng đổi trạng thái cho UI, dọn sau 90 ngày; nhật ký trả lời "ai làm gì, được phép không",
*(đề xuất)* **không tự xoá** (ứng dụng cục bộ một người dùng, dung lượng nhỏ). Hai bảng ghi trong cùng giao dịch khi cùng một hành động.

**Che bí mật (T5):** token OAuth, mã đăng nhập, cookie không bao giờ vào nhật ký, log CLI, prompt hay sự kiện. Backend lọc theo khoá
(`token`, `secret`, `authorization`, …) trước khi ghi `details`. Token OAuth ở macOS Keychain (TK1); đăng nhập CLI do chính CLI giữ,
backend không đọc.

## 9. Còn mở

| Mục | Phụ thuộc |
|---|---|
| Cờ CLI cho Gemini qua `agy` (Claude đã kiểm) | Sau MVP (D-15) |
| Hạn mức mặc định theo số đo thật | **S5** |
| Công cụ `meeting.*` | **S5** |
| Quyền OAuth cụ thể từng nền tảng | **S2** |
| Năng lực và công cụ `memory.*` | TK4 |

## 10. Để lại cho người dựng

Tên công cụ MCP cụ thể, cách gắn mã lượt chạy vào MCP, danh sách khoá cần che, chỉ mục bảng nhật ký.
