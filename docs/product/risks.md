# Rủi ro

Mức độ: **Cao / Trung bình / Thấp** (khả năng × tác động, ước tính chủ quan, xem lại sau spike).

## 1. Kỹ thuật

| ID | Rủi ro | Mức | Dấu hiệu phát hiện | Giảm thiểu |
|---|---|---|---|---|
| T1 | Điều phối nhiều Agent không ổn định: vòng lặp làm lại vô hạn, mất ngữ cảnh, kết quả không nhất quán | Cao | Task lặp quá N lần, token/Campaign tăng bất thường | Giới hạn số lần làm lại, timeout, schema đầu ra có kiểm tra, điểm dừng chờ người |
| T2 | Job video bất đồng bộ lỗi/treo; URL kết quả hết hạn trước khi tải | Cao | Job quá hạn không có kết quả, file thiếu | Máy trạng thái job, poll + webhook, tải và lưu ngay, retry có idempotency |
| T3 | Hiệu năng 3D khi đông Agent hoặc máy yếu | Trung bình | FPS giảm, bộ nhớ GPU cao | LOD/gộp nhân vật (D-5), tắt chuyển động trang trí, đo ngân sách hiệu năng ở prototype S4 (three.js + R3F, D-11) |
| T4 | Trạng thái 3D lệch trạng thái thật (mất sự kiện, race) | Trung bình | Nhân vật ở phòng sai so với tab Status | Event Bus là nguồn duy nhất, sự kiện có số thứ tự, đồng bộ lại snapshot khi kết nối lại |
| T5 | Lưu API key (video, tích hợp) và token OAuth không an toàn; đăng nhập CLI của gói thuê bao nằm trên máy người dùng | Cao | Key xuất hiện trong log/client | Mã hóa lưu trữ, không trả key về client, xoay vòng, kiểm nhật ký |
| T6 | Bộ nhớ phình to, nhiễu, rò rỉ giữa Campaign | Trung bình | Chất lượng giảm, Agent trích dữ liệu Campaign khác | Phân tách theo Campaign, tóm tắt/hết hạn, kiểm quyền truy xuất |
| T7 | Phụ thuộc provider LLM (hiện chỉ Claude và Gemini, thêm Codex sau, D-9): khác CLI, lỗi, thay đổi model | Trung bình | Lượt CLI lỗi tăng, model bị gỡ | CLI Harness Gateway, fallback giữa Claude/Gemini, ghim phiên bản model |
| T8 | Prompt injection qua nội dung bên ngoài (kết quả web search, Business Discovery, link người dùng gửi theo D-4, bình luận) khiến Agent làm theo chỉ dẫn nhúng: đăng bài, tốn tiền sinh video, lộ dữ liệu | Cao | Agent đề xuất hành động không liên quan yêu cầu; gọi tool bất thường sau khi đọc nguồn ngoài | Coi nội dung ngoài là dữ liệu, tách khỏi chỉ dẫn hệ thống; tool có tác dụng ngoài chỉ chạy qua BE kiểm quyền + Approval; giới hạn quyền tool theo vai trò; ghi nhật ký nguồn và tool call |
| T9 | **Đã xảy ra:** nhà cung cấp video AI ngừng dịch vụ — OpenAI Sora 2 API ngừng 2026-09-24, Google Veo 3.1 Preview ngừng 2026-10-22 (thay bằng Gemini Omni Flash); nguồn trong [platform-limits.md](platform-limits.md) mục 4 | Cao | Job video lỗi/model bị gỡ, thông báo deprecation | Adapter đa provider (đã chốt ở D-13 trong [roadmap.md](roadmap.md); MVP dùng provider `manual`/`template` không phụ thuộc API video); không phụ thuộc model Preview; theo dõi changelog; kiểm tra model trước mỗi Campaign |
| T10 | CLI đổi định dạng đầu ra, cờ headless hoặc cách tính hạn mức khi nâng cấp, làm hỏng việc phân tích đầu ra JSON/stream (D-7) | Trung bình | Lỗi phân tích đầu ra sau khi CLI tự cập nhật | Ghim phiên bản CLI, kiểm đầu ra theo schema, kiểm thử hợp đồng trước mỗi Campaign, chuẩn hoá trong CLI Harness Gateway |

## 2. Chính sách nền tảng

| ID | Rủi ro | Mức | Dấu hiệu phát hiện | Giảm thiểu |
|---|---|---|---|---|
| P1 | App chưa qua audit/App Review nên không đăng công khai (TikTok, Meta) | Cao | Bài chỉ riêng tư, quyền bị từ chối | Spike sớm, chuẩn bị hồ sơ review, dùng Upload nháp (D-3) |
| P2 | Tự động đăng TikTok vi phạm yêu cầu đồng ý/quyền riêng tư | Cao | Cảnh báo/khóa app | Xác nhận khi lên lịch từng bài, mặc định Upload nháp (D-3) |
| P3 | Gắn nhãn nội dung AI không đúng quy định nền tảng | Trung bình | Bài bị gỡ/giảm phân phối | Bật cờ khai báo AI mặc định, kiểm chính sách định kỳ |
| P4 | Thu thập xu hướng sai nguồn (scraping) vi phạm điều khoản | Cao | Bị chặn IP, khiếu nại | Chỉ nguồn hợp lệ (D-4), ghi nguồn và độ tin cậy |
| P5 | API/metric bị đổi hoặc khai tử, token hết hạn | Trung bình | Lỗi 400/190, số liệu rỗng | Theo dõi changelog, lớp adapter, luồng làm mới token, cảnh báo |
| P6 | Điều khoản dịch vụ video: cấm người thật/thương hiệu, hạn chế thương mại | Trung bình | Job bị từ chối kiểm duyệt | Kiểm tra trước khi gửi, hướng dẫn đầu vào, đổi provider |
| P7 | Quyền riêng tư/tuân thủ dữ liệu người dùng: lưu token OAuth, ảnh sản phẩm, số liệu tài khoản, có thể có dữ liệu cá nhân; Meta yêu cầu privacy policy và data deletion callback; luật bảo vệ dữ liệu (vd GDPR) | Trung bình | Yêu cầu xóa dữ liệu không thực hiện được; App Review bị từ chối vì thiếu chính sách | Privacy policy và data deletion callback trước App Review; xóa dữ liệu theo yêu cầu (token, ảnh, số liệu); giảm thiểu dữ liệu lưu; theo D-8 (cục bộ một người dùng) dữ liệu nằm trên máy người dùng và không có dịch vụ lưu trữ chung, nhưng data deletion callback của Meta vẫn cần endpoint công khai tới được từ Meta — kiểm ở spike S2; luật áp dụng (vd GDPR) xác định theo nơi người dùng và tài khoản Meta/TikTok, người dùng duyệt |
| P8 | Điều khoản dùng của Anthropic/Google/OpenAI có thể không cho phép điều khiển CLI bằng gói thuê bao từ một ứng dụng cục bộ (D-7); chưa kiểm tra điều khoản — **Cần kiểm chứng** | Cao | Tài khoản bị hạn chế/khoá, CLI đổi cách tính hạn mức | Đọc điều khoản từng provider trước khi triển khai (spike S5, đầu ra ghi vào [platform-limits.md](platform-limits.md) mục 5); chỉ chạy cục bộ một người dùng (D-8); giữ CLI Harness Gateway tách được để đổi hướng nếu bị cấm — đổi sang API key trả theo token phải có người dùng đồng ý lại (D-7) |
| P9 | OAuth TikTok/Meta cho ứng dụng cục bộ: vẫn cần app developer và redirect URI; callback `localhost` có thể không được chấp nhận (HTTPS/domain xác minh) — **Cần kiểm chứng theo từng nền tảng** | Trung bình | Lỗi redirect URI khi kết nối tài khoản, App Review từ chối | Nhận callback ở `localhost` cổng cố định; kiểm yêu cầu redirect/domain của từng nền tảng ở spike S2 |

## 3. Chi phí

| ID | Rủi ro | Mức | Dấu hiệu phát hiện | Giảm thiểu |
|---|---|---|---|---|
| C1 | Mức dùng LLM vượt kiểm soát do nhiều Agent/vòng làm lại, làm cạn hạn mức gói thuê bao (không phát sinh tiền theo token, D-7) | Cao | Số lượt/token mỗi Campaign vượt dự toán | Ngân sách mềm theo lượt/token/hạn mức cho Workspace/Campaign/Agent, hàng đợi giới hạn số Agent song song, cảnh báo (D-5) |
| C2 | Chi phí sinh video cao, tạo lại nhiều lần | Cao | Số phiên bản/video tăng nhanh | Xác nhận trước khi tạo lại, hiển thị ước tính giá, giới hạn số lần |
| C3 | Chi phí hạ tầng render 3D/realtime | Thấp | Băng thông/CPU tăng | Render phía client, đo trước khi quyết định |
| C4 | Số liệu usage không khớp thực tế: tiền video lệch hóa đơn, hạn mức CLI lệch mức provider báo | Trung bình | Chênh lệch khi đối soát | Ghi usage thật từ phản hồi API video và đầu ra CLI, đối soát định kỳ |
| C5 | Gói thuê bao Gemini Pro không thay thế billing của Gemini API: Veo chỉ dùng được trong app Gemini/Flow (có hạn mức/ngày), còn tạo video bằng API (Gemini Omni Flash, Runway…) cần trả phí riêng (Cần kiểm chứng) | Thấp (sau D-13) | Lỗi quota/billing khi gọi API video; hết hạn mức Veo trong ngày của gói Pro | **Đã giảm thiểu bằng D-13** ([roadmap.md](roadmap.md)): MVP không gọi API video trả phí; provider `manual` (người dùng tự tạo bằng Veo trong Gemini/Flow theo gói Pro rồi tải lên) là mặc định, provider `template` (Remotion/ffmpeg, miễn phí) dự phòng khi hết hạn mức. Còn lại: kiểm ở S3 hạn mức Veo/ngày của gói Pro, điều khoản thương mại, Gemini API có bậc miễn phí cho video không; dự toán theo giá API nếu sau này thêm provider trả phí |
| C6 | Hạn mức gói thuê bao cạn giữa chiến dịch: Agent dừng, Campaign dở dang | Cao | Lượt CLI trả lỗi hạn mức/rate limit; Agent vào `blocked_budget` | Theo dõi hạn mức đã dùng và cảnh báo sớm; hàng đợi giới hạn số Agent song song; lưu trạng thái Campaign để tiếp tục khi hạn mức làm mới; người dùng quyết định chờ hay đổi provider (Claude/Gemini) |

## 4. Sản phẩm

| ID | Rủi ro | Mức | Dấu hiệu phát hiện | Giảm thiểu |
|---|---|---|---|---|
| S1 | Chất lượng video AI không đủ dùng thương mại (sản phẩm biến dạng, chữ lỗi) | Cao | Tỷ lệ bị người dùng từ chối cao | Thử nhiều provider ở spike, ảnh tham chiếu, giữ người trong vòng duyệt |
| S2 | 3D trở thành trang trí, người dùng chỉ dùng Dashboard | Trung bình | Tỉ lệ dùng chế độ 3D thấp | Mọi tương tác chính truy cập được qua click nhân vật, thử nghiệm người dùng |
| S3 | Phạm vi quá lớn, khó ra MVP | Cao | Trễ tiến độ giai đoạn đầu | Vertical slice (roadmap), cắt theo luồng một chiến dịch đầu-cuối |
| S4 | Người dùng mất kiểm soát/niềm tin vào Agent tự hành | Trung bình | Phản hồi tiêu cực, huỷ duyệt | Quyền hạn rõ, Approval, nhật ký, Agent chỉ đề xuất thay đổi chiến lược |
| S5 | Giao diện cấu hình Agent quá phức tạp | Thấp | Người dùng bỏ dở khi tạo Agent | Mẫu vai trò gợi ý, giá trị mặc định, nhân bản |
