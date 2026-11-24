# Ranh giới: AI Agent / API bên ngoài / Backend / Hoạt ảnh 3D

Mỗi chức năng có **một nhóm chính**; cột "Phối hợp" nêu nhóm phụ trợ.
Nhóm: **AI** = LLM Agent suy luận; **API** = dịch vụ bên ngoài; **BE** = backend tất định; **3D** = hiển thị trên UI.

## 1. Phân loại chức năng

| Chức năng | Nhóm chính | Phối hợp |
|---|---|---|
| Hỏi thêm người dùng, làm rõ mục tiêu, hỏi đối tượng mục tiêu (Director) | AI | BE (lưu brief) |
| Chia nhỏ nhiệm vụ, giao việc, đánh giá chất lượng, yêu cầu làm lại (Coordinator) | AI | BE (task graph, giới hạn số lần làm lại) |
| Tổng hợp kết quả nghiên cứu, so sánh, đánh giá | AI | — |
| Nghiên cứu xu hướng, đối thủ, khách hàng, hook, hashtag, đặc điểm nền tảng (D-4) | AI | API (web search, Instagram hashtag/Business Discovery) |
| Brainstorm ý tưởng; viết 3 kịch bản khác biệt | AI | — |
| Chạy CLI chính chủ (Claude Code, Gemini CLI; Codex sau) như tiến trình con headless, đọc đầu ra JSON/stream, đếm lượt/token, retry, fallback, theo dõi hạn mức gói thuê bao (D-7, D-10: `child_process` trong backend Node) | BE | API (dịch vụ của provider qua CLI) |
| Điều phối task, hàng đợi, giới hạn đồng thời, điểm dừng chờ duyệt | BE | — |
| Sinh video 9:16 | API (dịch vụ video AI) | BE (job, poll/webhook, tải và lưu file), AI (viết prompt từ kịch bản) |
| Phiên bản video, lịch sử, tải kết quả trước khi URL hết hạn | BE | — |
| Đăng bài TikTok/Facebook/Instagram | API (API chính thức) | BE (OAuth, lịch, retry), AI (caption/hashtag) |
| Lịch đăng đơn lẻ/định kỳ, chọn tài khoản đích | BE | — |
| Lưu và làm mới token OAuth nhiều tài khoản | BE | API |
| Thu thập số liệu views/likes/comments/shares/followers | API | BE (job định kỳ, lưu chuỗi thời gian) |
| Tính Engagement Rate, tổng hợp theo Campaign | BE | — |
| Phân tích, so sánh, đề xuất cải thiện (Analytics Agent) | AI | BE (dữ liệu) |
| Bộ nhớ riêng/chung/theo Campaign: lưu, truy xuất | BE | AI (tóm tắt, quyết định ghi gì) |
| Kiểm quyền hành động, phê duyệt, nhật ký | BE | — |
| Theo dõi hạn mức/lượt/token LLM; số video theo provider; hạn mức mềm, cảnh báo (không có chi phí tiền, D-14) | BE | API (usage từ đầu ra CLI) |
| Phát sự kiện trạng thái tới UI (Event Bus) | BE | — |
| CRUD Agent, Workspace, Campaign, cấu hình | BE | — |
| Di chuyển nhân vật giữa phòng, animation làm việc/chờ/họp | 3D | — (đọc trạng thái từ BE) |
| Tùy chỉnh ngoại hình, trang phục, tên nhân vật | 3D | BE (lưu cấu hình) |
| Click nhân vật mở bảng 5 tab | 3D | BE |
| Bong bóng thoại/biểu tượng trạng thái trên nhân vật | 3D | BE (nội dung từ sự kiện) |
| Chuyển đổi 3D toàn màn hình ↔ Dashboard | 3D | — |

Nguyên tắc: AI chỉ quyết định nội dung và đề xuất; mọi hành động có tác dụng ngoài (đăng, tốn tiền, đổi chiến lược)
đi qua BE kiểm quyền và, khi cần, Approval. Tab Chat của Agent chuyên môn chỉ hỏi đáp/góp ý, việc mới chuyển Director (D-1).

## 2. Trạng thái Agent (backend) → khu vực → animation

Backend là nguồn sự thật duy nhất; 3D chỉ đọc trạng thái rời rạc qua Event Bus.

| Trạng thái BE | Điều kiện phát | Khu vực 3D | Animation |
|---|---|---|---|
| `offline` | Agent bị tắt/chưa khởi động | Bàn cố định của Agent (hoặc ẩn) | Mờ/ngồi tắt máy |
| `idle` | Rảnh, không có task | Lounge (General Workspace); Lounge hết chỗ thì bàn cố định | Idle loop: ngồi/đứng thở nhẹ |
| `assigned` | Vừa nhận task, chưa chạy | Bàn cố định của Agent | Nhận việc: đứng dậy/vẫy giấy tờ tại bàn |
| `researching` | Task nghiên cứu đang chạy | Bàn cố định của Agent (khu nhà của vai trò) | Gõ phím, đọc màn hình, lật tài liệu |
| `brainstorming` | Task ý tưởng đang chạy | Bàn cố định của Agent (khu nhà của vai trò) | Viết lên bảng, ghi chú dán |
| `writing` | Task viết kịch bản/prompt/caption đang chạy | Bàn cố định của Agent (xem quy tắc bàn cố định) | Ngồi gõ, ngừng suy nghĩ |
| `generating_video` | Job video đang render | Bàn cố định của Agent (khu nhà của vai trò) | Thao tác thiết bị/màn hình, thanh tiến độ gắn với % thật nếu có |
| `publishing` | Đang đăng/lên lịch bài | Bàn cố định của Agent (khu nhà của vai trò) | Gõ, biểu tượng gửi |
| `analyzing` | Analytics Agent đang chạy | Bàn cố định của Agent (khu nhà của vai trò) | Xem biểu đồ |
| `in_meeting` | Có phiên trao đổi thật giữa ≥2 Agent | Meeting Room | Ngồi quanh bàn, bong bóng thoại luân phiên |
| `conversing` | Director đang trao đổi với người dùng (hỏi thêm/làm rõ, trình bày kết quả; việc xin duyệt là `waiting_approval`) và đang chạy một lượt CLI | General Workspace (bàn Director cố định) | Quay về phía người dùng, bong bóng thoại, gật đầu/ghi chú |
| `awaiting_user_reply` | Director đã hỏi/làm rõ và đang chờ người dùng trả lời (không gọi LLM; khác `waiting_approval` là chờ duyệt kết quả/hành động) | General Workspace (bàn Director cố định) | Quay về phía người dùng, biểu tượng dấu hỏi/bong bóng chờ, đứng chờ |
| `planning` | Coordinator đang chia nhỏ nhiệm vụ, giao việc hoặc tổng hợp/so sánh kết quả của các Agent (chạy lượt CLI thật) | Bàn trưởng phòng của Coordinator | Bày thẻ việc lên bảng, sắp xếp/đối chiếu tài liệu |
| `reviewing` | Coordinator đang đánh giá đầu ra | Bàn trưởng phòng của Coordinator (không đi sang phòng Agent được đánh giá) | Đọc tài liệu, gật/lắc đầu theo kết quả |
| `waiting_approval` | Chờ người dùng duyệt | Agent khác: tại chỗ; Director: General Workspace (bàn Director cố định) | Giơ tài liệu/biểu tượng chờ, đứng chờ |
| `blocked_budget` | Bị chặn do vượt ngân sách, cạn hạn mức gói thuê bao hoặc hàng đợi (D-5, D-7) | Tại chỗ | Biểu tượng cảnh báo, đứng chờ |
| `error` | Task lỗi | Tại chỗ | Biểu tượng lỗi, vẻ bối rối |

Ghi chú ánh xạ `writing`: mọi Agent làm việc tại bàn cố định của mình, nên `writing` không còn đưa Agent sang Scriptwriting Department
(creative, video_producer, publisher viết prompt/caption ở bàn của họ); chỉ scriptwriter có bàn ở Scriptwriting. Thay cho lựa chọn cũ "chưa được người dùng xác nhận".

Quy tắc:
- Đổi trạng thái → nhân vật di chuyển tới đích (đường đi là hiệu ứng chuyển tiếp, không cần sự kiện backend riêng).
- **Bàn cố định**: mỗi Agent có một bàn riêng ngay khi dựng roster (theo thứ tự), trong khu nhà của vai trò (`ROLE_HOME_ZONE`); Director và Coordinator có bàn cố định của mình. Mọi trạng thái làm việc, `assigned` và `offline` đặt Agent tại bàn đó; không Agent nào chiếm bàn của Agent khác, kể cả khi chủ bàn đang họp hay ở Lounge. Agent chỉ rời bàn khi `in_meeting` (ghế Meeting Room) hoặc `idle` (ghế Lounge; Lounge hết chỗ thì ngồi bàn của mình, không mở module); quay lại làm việc thì về đúng bàn cũ. `waiting_approval`/`blocked_budget`/`error` giữ chỗ hiện tại.
- Coordinator không đi giữa các phòng: `planning`/`reviewing` đều ở bàn trưởng phòng.
- `in_meeting` chỉ hiện khi backend thật sự có phiên trao đổi giữa các Agent.
- Bàn Director là bàn cố định nằm trong General Workspace, không phải khu thứ bảy; Director không di chuyển sang khu khác khi `conversing`/`awaiting_user_reply`/`waiting_approval`.
- Phòng đầy: bàn cố định của Agent nằm ở General Workspace kèm nhãn phòng ban, hết nữa thì ở module bàn mở rộng (D-6). Nhiều nhân vật: LOD/gộp (D-5).
- Trạng thái "đang chờ" sau khi hoàn thành là `idle`; không dựng "đang làm việc" khi backend không ở trạng thái làm việc.

### Chuyển động trang trí được phép

Chỉ các chuyển động **không biểu thị hành động công việc**: idle loop khi `idle`/`offline`, chớp mắt, hít thở, chuyển động
môi trường (cây lay, đèn, màn hình nền). Cấm: nhân vật đi lại, gõ phím, họp, cầm tài liệu khi trạng thái BE không tương ứng.
Chuyển động trang trí không được gây hiểu nhầm trạng thái và có thể tắt (giảm hiệu năng/accessibility).
