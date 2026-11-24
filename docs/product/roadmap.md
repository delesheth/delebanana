# Lộ trình đề xuất

Tech stack đã chốt ở D-10..D-12 (TypeScript full-stack, three.js qua React Three Fiber, pnpm); D-7, D-8 chốt cách truy cập model và mô hình triển khai. Các giai đoạn dưới đây mô tả quy trình, không phụ thuộc lựa chọn cụ thể trong từng bước.

## 1. Quy trình theo giai đoạn

### Giai đoạn 1 — Nghiên cứu (spike kiểm chứng)
| Spike | Mục tiêu | Đầu ra |
|---|---|---|
| S1 | Đối chiếu giới hạn API với tài liệu chính thức ([platform-limits.md](platform-limits.md)); chọn ≥3 dịch vụ video để thử | Bảng giới hạn đã kiểm chứng (ngày, người kiểm). **Đã làm phần đối chiếu tài liệu (2026-11-17, tra cứu web); các dòng "Cần kiểm chứng" còn lại chờ S2/S3.** Phát hiện: Sora 2 API và Veo 3.1 Preview đã ngừng; ứng viên video hiện tại: Gemini Omni Flash, Runway (cổng nhiều model), Kling |
| S2 | Nộp/kiểm yêu cầu app review TikTok và Meta (thời gian, hồ sơ) | **Đã hoàn thành nghiên cứu Meta & Instagram (2026-11-24):** Hoàn thành tài liệu hướng dẫn tạo app Meta ([meta-app-setup.md](../guides/meta-app-setup.md)), giải quyết hạn chế OAuth localhost bằng phương án Page Token dự phòng, triển khai thành công đăng Instagram Reels qua Graph API Resumable Upload ([kế hoạch triển khai](../superpowers/plans/2026-11-24-instagram-api-publish.md)) |
| S3 | Thử sinh video 9:16 từ ảnh sản phẩm | **Đã hoàn thành luồng MVP (2026-11-23/24):** Triển khai cơ chế Video Prompt Artifact, hướng dẫn người dùng tạo video ngắn qua app Gemini (Veo/Gemini Omni Flash) với gói Pro sẵn có (D-13), hỗ trợ tải lên và thẩm định tự động quy chuẩn video 9:16 trước khi duyệt |
| S4 | Prototype 3D trên D-11 (three.js + React Three Fiber): scene isometric, 6 khu vực, vài nhân vật, hiệu năng; đo FPS với nhiều nhân vật | **Xong (2026-11-17):** Đo FPS ổn định > 60 FPS; đã phát triển hoàn chỉnh thành hệ thống văn phòng 3D thực tế trong `apps/web/src/scene/` và `apps/web/src/office/` với 6 phòng đối xứng, animation gắn với Event Bus backend thời gian thực |
| S5 | **Xong (2026-11-18), xem [s5-cli-spike](../research/2026-11-18-s5-cli-spike.md):** cờ Claude Code cho TK3 đã kiểm, hạn mức đọc được từ `rate_limit_event`, Gemini CLI hết dùng được với gói Pro (→ D-15); vòng Director → Coordinator → Researcher → họp → báo cáo chạy thật 11/11 lượt, ~0,3% hạn mức 5 giờ/lượt; chốt Hono (D-16). Mục tiêu ban đầu: thử vòng Director–Coordinator–Agent với model khác nhau trên D-10, mỗi lượt Agent là một lần chạy CLI headless bằng `child_process` (D-7); đo độ trễ khởi động CLI, hạn mức gói thuê bao và độ ổn định đầu ra stream JSON; đọc điều khoản dùng của từng provider về việc điều khiển CLI bằng gói thuê bao từ ứng dụng cục bộ (P8); chọn Fastify hoặc Hono | Đánh giá ổn định, độ trễ khởi động CLI, số lượt/hạn mức gói thuê bao đã dùng mỗi Campaign, độ ổn định định dạng đầu ra stream JSON, kết luận về điều khoản (P8, ghi nguồn và ngày), lựa chọn Fastify/Hono |

### Giai đoạn 2 — Thiết kế
- **Đã hoàn thành đầy đủ:**
  - Mô hình miền TK1 ([01-domain-model.md](../design/01-domain-model.md)).
  - Vòng đời trạng thái và hợp đồng sự kiện TK2 ([02-lifecycle-events.md](../design/02-lifecycle-events.md)).
  - Phân quyền, kiểm toán, phê duyệt TK3 ([03-permissions-approvals-audit.md](../design/03-permissions-approvals-audit.md)).
  - Bộ nhớ phân tách theo chiến dịch TK4 ([04-memory.md](../design/04-memory.md)).
  - Quy tắc bố cục và đối xứng nội thất 3D TK5 ([05-office-decor.md](../design/05-office-decor.md)).

### Giai đoạn 3 — Triển khai
1. **MVP vertical slice (Đã hoàn thành cốt lõi 2026-11-24):**
   - **Backend Hono + SQLite (Drizzle ORM):** Toàn bộ giao dịch chuyển trạng thái nguyên tử, Unit of Work, Event Bus SSE phát sự kiện thời gian thực.
   - **Domain Lifecycle & Events (`packages/domain`):** State machine cho 6 thực thể (Campaign, Task, Approval, VideoVersion, Post, Stage), logic tính toán `deriveAgentState`.
   - **CLI Harness Gateway & Agent Runtime:** Điều khiển Claude Code headless, bắt sự kiện, đếm lượt và hạn mức.
   - **Campaign Flow:** Đầy đủ luồng chat với Director → brief → nghiên cứu → sinh 3 kịch bản → người dùng duyệt kịch bản → hướng dẫn làm video → duyệt video.
   - **Đăng bài đa kênh:** Tự động đăng Instagram Reels qua Meta Graph API (resumable upload) khi liên kết Page.
   - **3D Virtual Office:** Scene Three.js / R3F với 6 khu vực, di chuyển nhân vật dọc hành lang, animation theo trạng thái backend, bảng điều khiển Room Dock và duyệt bài.
   - **Hệ thống kiểm thử:** 54 file kiểm thử, 589 tests vitest vượt qua 100%.
2. Mở rộng: TikTok draft upload, mở rộng thêm nền tảng, quản lý chi phí & ngân sách mềm.
3. Hoàn thiện: Tùy chỉnh nhân vật chi tiết, tối ưu hiệu năng đồ họa.

Mỗi giai đoạn có cổng quyết định: kết quả spike có thể làm thay đổi phạm vi nhưng không loại bỏ tính năng cốt lõi nếu chưa có sự đồng ý của người dùng.

## 2. Quyết định đã chốt (người dùng duyệt 2026-11-17)

| ID | Mâu thuẫn | Quyết định | Phương án bị loại và lý do |
|---|---|---|---|
| D-1 | Chat từng Agent vs Director là đầu mối duy nhất | Tab Chat của Agent chuyên môn chỉ hỏi đáp/góp ý về việc đang làm; yêu cầu việc mới/đổi hướng chuyển về Director thành đề xuất | Cho chat giao việc trực tiếp: phá vai trò đầu mối duy nhất, khó kiểm soát |
| D-2 | Một video mỗi yêu cầu vs giới hạn độ dài clip | Chỉ video ngắn: một yêu cầu = một lần gọi dịch vụ = một video 9:16 trong giới hạn của model; chỉnh sửa/tạo lại = phiên bản mới; không ghép clip | Ghép nhiều clip thành video dài: phức tạp, khó nhất quán, vượt phạm vi |
| D-3 | Tự động đăng vs quy định TikTok | Facebook/Instagram tự động theo lịch; TikTok cần xác nhận quyền riêng tư/đồng ý khi lên lịch từng bài, nếu app chưa audit hoặc thiếu đồng ý thì Upload nháp; "duyệt trước khi đăng" có cho mọi nền tảng | Tự động hoàn toàn TikTok: vi phạm yêu cầu UX; bỏ TikTok: mất tính năng cốt lõi |
| D-4 | Nghiên cứu xu hướng vs không có API chính thức | Chỉ nguồn hợp lệ: web search LLM, nguồn công khai, Instagram hashtag/Business Discovery, số liệu tài khoản đã kết nối, link người dùng cung cấp; không scraping; mỗi kết quả ghi nguồn và độ tin cậy; social listening trả phí là mở rộng sau | Scraping: rủi ro điều khoản; mua dịch vụ ngay: tốn chi phí chưa cần |
| D-5 | Không giới hạn Agent vs chi phí/hiệu năng | Không giới hạn cứng trong dữ liệu; giới hạn mềm cấu hình: ngân sách theo Workspace/Campaign/Agent, số Agent chạy đồng thời (hàng đợi), cảnh báo; 3D dùng LOD/gộp | Giới hạn cứng số Agent: trái yêu cầu gốc |
| D-6 | Bố cục cố định vs số Agent không giới hạn | Bố cục phòng cố định; mỗi phòng có chỗ ngồi co giãn theo lưới bàn; phòng đầy thì làm việc ở General Workspace kèm nhãn phòng ban hoặc mở rộng theo module bàn; vị trí phòng không đổi | Bố cục tự do: trái yêu cầu "bố cục cố định" |
| D-7 | Cách truy cập model: API key trả theo token vs CLI chính chủ dùng gói thuê bao | **Phương án B:** Agent gọi model qua CLI chính chủ dùng hạn mức gói thuê bao của người dùng: Claude Code (gói Claude), Gemini CLI (gói Gemini Pro), sau này Codex CLI. Không dùng API key trả theo token cho LLM. Điều khoản dùng gói thuê bao qua ứng dụng cục bộ — **Cần kiểm chứng** (P8) | **A: API key trả theo token** (Anthropic API, Gemini API, OpenAI API): tốn thêm chi phí trong khi người dùng đã có gói thuê bao |
| D-8 | Mô hình triển khai: cục bộ một người dùng vs dịch vụ nhiều người dùng | **Phương án A:** website chỉ chạy trên máy người dùng, chỉ một người dùng. Workspace vẫn giữ để tổ chức theo thương hiệu/sản phẩm/dự án, không có nhiều thành viên/vai trò trong Workspace | **B: dịch vụ lưu trữ nhiều người dùng**: không cần, và không hợp với D-7 (gói thuê bao của một người dùng không chia cho nhiều người) |
| D-9 | Nhà cung cấp LLM | Chỉ **Claude (Anthropic) và Gemini (Google)**; mở rộng **OpenAI Codex** sau. Cấu hình provider/model riêng từng Agent giữ nguyên trong tập này; không thiết kế quanh provider khác. CLI Harness Gateway là lớp trừu tượng để thêm Codex sau | Thêm provider khác ngay: ngoài ràng buộc của người dùng (có gói Claude và Gemini Pro) |
| D-10 | Tech stack | **TypeScript full-stack.** Frontend Vite + React; backend Node (Fastify hoặc Hono, chọn ở spike S5) với WebSocket/SSE cho sự kiện trạng thái; SQLite (Drizzle ORM), tệp video lưu trên đĩa; hàng đợi job và scheduler chạy trong tiến trình, lưu trên SQLite; điều khiển Claude Code / Gemini CLI bằng `child_process` (đầu ra JSON/stream); kiểm thử bằng vitest | **Python backend + React:** hai ngôn ngữ, khó dùng chung kiểu trạng thái Agent; **app desktop Tauri/Electron:** đóng gói phức tạp, có thể bọc sau từ D-10 |
| D-11 | Dựng 3D | **three.js qua React Three Fiber (+ drei)**, đối tượng 3D thật phong cách stylized/low-poly, camera isometric | **Babylon.js:** tích hợp React kém tự nhiên; **PlayCanvas:** editor trên cloud, không hợp chạy cục bộ; **sprite/2.5D:** lệch yêu cầu Stylized 3D |
| D-12 | Trình quản lý gói | **pnpm.** Hệ quả: tác vụ mã đầu tiên chuyển npm sang pnpm (commit `pnpm-lock.yaml`, bỏ `package-lock.json`); **đã chuyển ở spike S4 (2026-11-17)**: pnpm workspace `apps/*`, `packages/*`, script `test` = `vitest run` | **Giữ npm** (trạng thái hiện tại của repo): không chọn, chuyển sang pnpm ở tác vụ mã đầu tiên |
| D-13 | Nguồn video cho MVP: không tốn thêm chi phí, tận dụng gói đã có | **Phương án B (adapter đa provider), MVP chỉ có hai provider miễn phí:** (1) **`manual` — mặc định:** Agent viết prompt video và chọn ảnh tham chiếu; app dừng ở Approval "Tạo video", người dùng tự sinh video bằng Veo trong app Gemini/Flow (hạn mức gói Gemini Pro), rồi tải tệp lên làm phiên bản video; (2) **`template` — dự phòng:** dựng video 9:16 từ ảnh sản phẩm bằng code (Remotion hoặc ffmpeg: chuyển động ảnh, chữ, phụ đề, nhạc), bố cục do Agent viết qua gói thuê bao; dùng khi hết hạn mức Pro hoặc cần tự động hoàn toàn. API video trả phí (Gemini Omni Flash, Runway, Kling) để sau, cắm vào cùng adapter | **A: một provider API trả phí mặc định:** tốn thêm chi phí; **bot điều khiển giao diện Gemini/Flow:** nhiều khả năng vi phạm điều khoản Google, có thể bị khoá tài khoản, dễ hỏng khi giao diện đổi; **model mã nguồn mở chạy cục bộ (Wan, LTX-Video):** rất chậm trên Mac, chất lượng thấp hơn — có thể thử thêm sau |
| D-14 | Có thêm API trả phí (video, LLM, social listening…) sau MVP không | **Không thêm API trả phí, và app không tốn thêm chi phí nào** (người dùng chốt 2026-11-18): không dịch vụ, hosting, tên miền, giấy phép thương mại hay SaaS trả phí. Chỉ dùng gói thuê bao sẵn có qua CLI (D-7), API chính thức miễn phí của nền tảng, thư viện miễn phí, xử lý cục bộ và bước thủ công của người dùng. Mọi dependency/dịch vụ mới phải kiểm giá và giấy phép trước (vd. giấy phép Remotion, redirect OAuth có cần tên miền). Video giữ hai provider `manual` và `template` của D-13; adapter vẫn giữ để thay provider miễn phí khác | **Gemini Omni Flash, Runway, Kling (API video trả phí):** tốn thêm chi phí; **social listening trả phí** (D-4): tốn thêm chi phí |
| D-15 | Gemini CLI ngừng phục vụ gói Google AI Pro từ 2026-06-18 (S5) | **MVP chỉ dùng Claude Code cho mọi Agent** (người dùng chốt 2026-11-18). Giữ lớp adapter của CLI Harness Gateway để thêm Gemini qua Antigravity CLI (`agy`) sau khi kiểm được cách giới hạn công cụ và điều khoản. Gói Gemini Pro vẫn dùng cho Veo trong app Gemini/Flow (D-13) | **Dùng `agy` ngay:** chậm (~38 s/câu), ~43k token/câu, ~60 công cụ không tắt được bằng cờ (rủi ro T8), điều khoản chưa rõ; **Gemini CLI bằng API key:** tốn phí (D-14) |
| D-16 | Backend Node: Fastify hay Hono (D-10) | **Hono** (+ `@hono/node-server`), người dùng chốt 2026-11-18 theo đề xuất của S5: gọn, kiểu TypeScript tốt, có sẵn SSE cho Event Bus (TK2 mục 6.3); MIT, miễn phí | **Fastify:** hệ plugin và kiểm schema mạnh nhưng nặng hơn mức cần cho ứng dụng cục bộ một người dùng |
| D-17 | Số liệu TikTok của đối thủ không lấy được miễn phí (S5: TikTok chặn đọc trang; Kalodata/FastMoss trả phí) | **Bỏ việc thu số liệu TikTok của đối thủ** (người dùng chốt 2026-11-18). Nghiên cứu đối thủ, nếu có, chỉ dùng thông tin công khai định tính (báo chí, báo cáo công khai, link người dùng gửi — D-4); Coordinator không yêu cầu làm lại vì thiếu số liệu này | Thu follower/view/video top của đối thủ bằng công cụ trả phí (D-14) hoặc đọc trang TikTok (bị chặn, rủi ro điều khoản) |
| D-18 | Số Agent mỗi phòng (rà lại workflow; người dùng chốt 2026-11-18, phương án tài liệu + mã) | **Mặc định/tối đa mỗi phòng:** Research 2/4 (researcher + analyst), Creative 1/2, Scriptwriting 1/2, Video Studio 1/2, General Workspace 2/4 (Coordinator + publisher), Director Office 1/1. **Roster mặc định 8, tối đa 16** (15 vai trò theo `STAFFING_ORDER` trong `packages/domain`, Agent thứ 16 trở đi là Agent dư). Lý do: TK3 giới hạn 2 lượt CLI song song mỗi Workspace và 1 lượt mỗi provider, mà mọi Agent dùng Claude (D-15) ⇒ thực tế một lượt Agent một lúc, thêm Agent không thêm thông lượng. **D-5/D-6 giữ nguyên:** 4 là sức chứa bàn của mỗi phòng 3D, không phải giới hạn cứng của dữ liệu; Agent vượt sức chứa ngồi tạm ở General Workspace hoặc module bàn | Giữ 6 Agent với 2 Researcher và 7 chỗ phòng quay: nhiều bàn trống, thiếu analyst/video/publisher; giới hạn cứng 16 Agent: trái D-5 |

### Hệ quả của D-7, D-8 và D-9

- **Điều khiển CLI như tiến trình con:** backend chạy Claude Code / Gemini CLI ở chế độ headless với đầu ra JSON/stream; mỗi lượt Agent là một lần chạy CLI. Module M4 LLM Gateway thành **CLI Harness Gateway** ([modules.md](modules.md)).
- **Hạn mức thay cho tiền:** hạn mức gói thuê bao giới hạn số Agent chạy song song và số lượt (D-5 áp dụng cho hàng đợi). Cost Management đo LLM theo lượt/token/hạn mức đã dùng thay vì tiền; chi phí video vẫn đo bằng tiền.
- **Video vẫn cần API trả phí riêng nếu muốn tự động sinh bằng AI:** gói Gemini Pro chỉ cho dùng Veo trong app Gemini/Flow, không thay thế billing của Gemini API — **Cần kiểm chứng** (C5, S3). Vì vậy MVP tránh API video trả phí theo D-13.

### Hệ quả của D-13

- **Bước video `manual` không tự động hoàn toàn:** Campaign dừng ở Approval "Tạo video" tới khi người dùng tải tệp lên; trạng thái `generating_video` ([boundaries.md](boundaries.md)) với provider `manual` nghĩa là chờ người dùng, không có % tiến độ thật. Số video mỗi ngày bị giới hạn bởi hạn mức gói Gemini Pro.
- **D-2 vẫn giữ:** một lần sinh trong Gemini/Flow hoặc một lần render template = một video 9:16 = một phiên bản; không ghép clip.
- **Kiểm tra tệp tải lên:** backend kiểm tỉ lệ 9:16, thời lượng, định dạng trước khi nhận làm phiên bản video.
- **Cost Management (M10):** MVP không có chi phí tiền cho video; chỉ đếm số video theo provider (`manual`/`template`).
- **Cần kiểm chứng:** điều khoản dùng thương mại video sinh từ app Gemini/Flow theo gói Pro (watermark SynthID, quyền đăng lên mạng xã hội); giấy phép Remotion cho cá nhân/công ty nhỏ.
- **Rủi ro mới:** điều khoản Anthropic/Google/OpenAI về việc điều khiển CLI bằng gói thuê bao từ ứng dụng cục bộ — **Cần kiểm chứng** (P8); hạn mức cạn giữa chiến dịch (C6); CLI đổi định dạng đầu ra khi nâng cấp (T10).
- **OAuth TikTok/Meta:** vẫn cần tài khoản app developer và redirect URI. Ứng dụng cục bộ nhận callback ở `localhost` (cổng cố định hoặc đã đăng ký); nền tảng có chấp nhận redirect `localhost`/HTTP hay bắt buộc HTTPS và domain đã xác minh (cả `PULL_FROM_URL` của TikTok) — **Cần kiểm chứng theo từng nền tảng** ở S2.

## 3. Quyết định còn mở (chưa chốt)

Câu hỏi "Nhiều người dùng trong một Workspace" **không áp dụng** vì D-8 (một người dùng).

| Quyết định | Phương án | Ghi chú |
|---|---|---|
