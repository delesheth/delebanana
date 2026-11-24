# Module chính

Quy ước: **D-n** là quyết định đã chốt trong [roadmap.md](roadmap.md). Tech stack chung: TypeScript full-stack (D-10), three.js qua React Three Fiber cho 3D (D-11), pnpm (D-12).

## 1. Danh sách module

| # | Module | Trách nhiệm | Hiện trạng (2026-11-24) |
|---|---|---|---|
| M1 | Identity & Workspace | Một người dùng (D-8), nhiều Workspace theo thương hiệu/sản phẩm/dự án. Không có nhiều thành viên/vai trò trong Workspace (không áp dụng theo D-8). | **Hoàn thành:** Schema & client SQLite tại `apps/server/src/db/` |
| M2 | Agent Registry | Tạo/sửa/xóa/nhân bản Agent; cấu hình provider, model, system prompt, tools, memory, permissions; ngoại hình, trang phục, tên. Không giới hạn cứng số lượng/vai trò (D-5). | **Hoàn thành:** Roster 8 vai trò mặc định, mô hình tại `packages/domain/src/staffing.ts`, fixture tại `apps/web/src/office/rosterFixture.ts` |
| M3 | Orchestration Engine | Director, Coordinator, task graph, giao việc, vòng đánh giá và làm lại, điểm dừng chờ duyệt, hàng đợi giới hạn đồng thời (D-5). | **Hoàn thành:** Engine tại `apps/server/src/campaign/engine.ts`, state machine tại `packages/domain/src/lifecycle/` |
| M4 | CLI Harness Gateway | Điều khiển CLI chính chủ (Claude Code, Gemini CLI; Codex CLI sau) như tiến trình con headless với đầu ra JSON/stream; mỗi lượt Agent là một lần chạy CLI; trừu tượng đa provider, đếm lượt/token, theo dõi hạn mức gói thuê bao, retry, fallback, chuẩn hoá đầu ra khi CLI đổi định dạng, web search cho nghiên cứu (D-7, D-9). Không dùng API key trả theo token cho LLM. Chạy bằng `child_process` trong backend Node (D-10). | **Hoàn thành:** Gateway tại `apps/server/src/agents/gateway.ts`, Harness Claude Code tại `apps/server/src/agents/harness.ts`, Runtime tại `apps/server/src/agents/runtime.ts` |
| M5 | Memory | Bộ nhớ riêng từng Agent, bộ nhớ chung, tách theo Campaign; học từ phản hồi người dùng và số liệu hiệu suất; chỉ đề xuất, không tự đổi chiến lược. | **Thiết kế xong (TK4):** Đang tích hợp trong luồng campaign runtime |
| M6 | Campaign & Content | Chiến dịch, brief, tài sản đầu vào (ảnh, mô tả, link/video tham khảo, mục tiêu), 3 kịch bản, phiên bản video, lịch đăng, nội dung đã xuất bản. | **Hoàn thành:** Schema, Engine, UI Chat Composer, chi tiết chiến dịch tại `apps/web/src/ui/CampaignDetail.tsx` |
| M7 | Video Production Pipeline | Adapter nguồn video miễn phí (`manual`, `template` — D-13, D-14), job bất đồng bộ, theo dõi render, tải và lưu kết quả, lịch sử phiên bản. Một yêu cầu = một lần sinh = một video 9:16 (D-2). | **Hoàn thành:** Hỗ trợ Video Prompt Artifact, hướng dẫn người dùng làm video Gemini (Veo), tải tệp lên và thẩm định tự động tại `apps/server/src/http/videos.ts` |
| M8 | Publishing & Social Accounts | OAuth nhiều tài khoản mỗi nền tảng, chọn tài khoản đích, lịch đơn lẻ/định kỳ, duyệt trước khi đăng, chế độ Upload nháp cho TikTok (D-3). | **Hoàn thành:** Meta Graph API (Instagram Reels Resumable Upload + liên kết Page) tại `apps/server/src/publish/`, worker tự động xuất bản |
| M9 | Analytics | Thu thập số liệu định kỳ (views, likes, comments, shares, Engagement Rate, followers), so sánh, đề xuất của Analytics Agent. | **Kế hoạch mở rộng sau MVP:** Đã có cấu trúc bảng số liệu |
| M10 | Cost Management | Lượt/token/hạn mức gói thuê bao đã dùng theo Agent/Model/Provider/Campaign (LLM không tính tiền, D-7); số video theo provider `manual`/`template` (không có chi phí tiền, D-13, D-14); hạn mức mềm, cảnh báo (D-5). | **Hoàn thành:** Theo dõi usage token/rate limits tại `apps/server/src/agents/usage.ts` |
| M11 | Event Bus & Realtime | Luồng sự kiện trạng thái từ backend tới UI; nguồn duy nhất cho 3D và tab Logs. | **Hoàn thành:** SSE Event Bus tại `apps/server/src/core/bus.ts`, kết nối Live Connection tại `apps/web/src/live/connection.ts` |
| M12 | 3D Virtual Office | Scene isometric Stylized 3D, nhân vật tùy chỉnh, di chuyển giữa phòng, animation theo trạng thái, click mở bảng Agent, LOD khi đông (D-5, D-6); dựng bằng three.js qua React Three Fiber + drei, phong cách stylized/low-poly, camera isometric (D-11). | **Hoàn thành:** Văn phòng 3D hoàn chỉnh 6 phòng tại `apps/web/src/scene/`, animation nhân vật tại `apps/web/src/office/clips.ts`, cử chỉ di chuyển tại `apps/web/src/office/walk.ts` |
| M13 | Dashboard UI | 8 khu vực quản lý, bảng Agent 5 tab, chuyển đổi 3D toàn màn hình ↔ Dashboard. | **Hoàn thành:** UI Approval Panel, Room Dock, Director Chat, Staff List, Campaign View |
| M14 | Audit & Governance | Nhật ký hành động, kiểm quyền trước hành động quan trọng, phê duyệt. | **Hoàn thành:** Unit of Work ghi nhận giao dịch kèm kiểm quyền tại `apps/server/src/core/unitOfWork.ts`, bảng duyệt tại `apps/web/src/ui/ApprovalPanel.tsx` |

## 2. Bảng truy vết tính năng gốc → module

### Mục 2 — Cơ cấu Agent

| Tính năng gốc | Module |
|---|---|
| Director: đầu mối duy nhất với người dùng, hỏi thêm (đặc biệt đối tượng mục tiêu), trình bày kết quả, xin phê duyệt, bàn giao Coordinator | M3, M4 (chủ động nghiên cứu khi thiếu thông tin), M6, M13 (chat) |
| Coordinator: chia nhiệm vụ, giao việc, theo dõi, đánh giá chất lượng, yêu cầu làm lại, tổng hợp báo cáo | M3 |
| Agent chuyên môn gợi ý (Market/Trend/Competitor/Audience Research, Creative, Scriptwriter, Video Production, Social Media, Analytics) | M2 (mẫu vai trò), M3 |
| Tạo/sửa/nhân bản/xóa Agent, không giới hạn cứng số lượng/vai trò | M2, M13 |
| Provider/Model riêng từng Agent, toàn quyền cấu hình | M2, M4 |

### Mục 3 — Quy trình chiến dịch

| Tính năng gốc | Module |
|---|---|
| Tạo chiến dịch, giao việc cho Director qua chat; đầu vào ảnh/mô tả/chủ đề/link-video tham khảo/mục tiêu | M6, M13, M3 |
| Bước 1 Nghiên cứu: xu hướng TikTok/Reels, đối thủ, khách hàng, hook, hashtag/từ khóa, đặc điểm nền tảng; nghiên cứu độc lập rồi Coordinator tổng hợp (nguồn hợp lệ theo D-4) | M3, M4, M5 |
| Bước 2 Brainstorm và 3 kịch bản khác biệt; Director gửi người dùng chọn/duyệt | M3, M6, M14 |
| Bước 3 Sản xuất video: API dịch vụ video, một video mỗi yêu cầu, 9:16, theo dõi render, lịch sử phiên bản, chỉnh sửa/tạo lại | M7, M6 |
| Bước 4 Phê duyệt và đăng: tự động theo lịch hoặc duyệt trước; TikTok/Facebook/Instagram; nhiều tài khoản; lịch đơn lẻ/định kỳ; API chính thức | M8, M14 |
| Bước 5 Phân tích: views, likes, comments, shares, Engagement Rate, followers; so sánh; đề xuất cải thiện | M9, M5 |

### Mục 4 — Văn phòng 3D

| Tính năng gốc | Module |
|---|---|
| Văn phòng isometric Stylized 3D, bố cục cố định, 6 khu vực (Research, Creative, Scriptwriting, Video Studio, Meeting Room, General Workspace), hiển thị thành 8 phòng (thêm Director Office và Lounge Bar) | M12 |
| Nhân vật 3D riêng mỗi Agent; tùy chỉnh ngoại hình, trang phục, tên | M12, M2 |
| Di chuyển giữa phòng, làm việc, họp, chờ duyệt, nghỉ/chờ việc theo trạng thái thật | M12, M11 |
| Click nhân vật xem thông tin và tương tác | M12, M13 |

### Mục 5 — Giao diện quản lý

| Tính năng gốc | Module |
|---|---|
| Agent Management | M2, M13 |
| Campaign Management (chiến dịch, nhiệm vụ, tiến độ) | M6, M3, M13 |
| Workspace Management | M1, M13 |
| Social Accounts | M8, M13 |
| Content Management (kịch bản, video, lịch đăng, đã xuất bản) | M6, M7, M8, M13 |
| Analytics (tổng quan và báo cáo chi tiết) | M9, M13 |
| Settings (hệ thống, provider, model, cấu hình CLI, kết nối tích hợp miễn phí) | M4, M1, M13 |
| Cost Management | M10, M13 |
| Tab Status | M11, M13 |
| Tab Task | M3, M13 |
| Tab Logs | M11, M14, M13 |
| Tab Chat (chỉ hỏi đáp/góp ý, việc mới chuyển Director — D-1) | M3, M13 |
| Tab Config | M2, M13 |
| Chuyển đổi 3D toàn màn hình ↔ Dashboard | M13, M12 |

### Mục 6 — Bộ nhớ và học hỏi

| Tính năng gốc | Module |
|---|---|
| Bộ nhớ riêng từng Agent | M5 |
| Bộ nhớ chung chia sẻ giữa Agent | M5 |
| Phân tách theo Campaign | M5, M6 |
| Học từ phản hồi người dùng về chất lượng | M5, M6 |
| Học từ số liệu hiệu suất thực tế | M5, M9 |
| Chỉ đề xuất; không tự đổi chiến lược/hành động quan trọng ngoài quyền | M14, M2 (permissions), M3 |
