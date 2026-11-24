# Bước tiếp theo: Video và Publish (đầu-cuối)

> **Phạm vi:** tài liệu nghiên cứu/lộ trình (phiếu A/2), **không sửa mã**. Phiếu B sẽ hiện thực nút chuyển sang Gemini + giới hạn độ dài.
> **Ngày:** 2026-11-23. **Nguồn dữ liệu Gemini:** orchestrator tra web 2026-11-23 (coi là đã kiểm, ghi URL); các nguồn nền tảng TikTok/Meta lấy từ
> [platform-limits.md](../product/platform-limits.md) (đã kiểm chứng 2026-11-17, chỉ đối chiếu tài liệu, chưa chạy thử). Dữ kiện nào không có nguồn
> được ghi `Cần kiểm chứng`; không có con số nào ngoài những gì ghi kèm nguồn.
> **Ràng buộc tiền đề:** D-2 (không ghép clip), D-3 (TikTok xác nhận từng bài / Upload nháp), D-8 (cục bộ, một người dùng), D-13 (provider `manual` + `template`), D-14 (không tốn thêm chi phí), D-15 (chỉ Claude Code).

## 1. Hiện trạng đầu-cuối

Luồng mong muốn: input sản phẩm (ảnh + mô tả) → nghiên cứu → kịch bản → duyệt kịch bản → video → duyệt video → đăng TikTok/Facebook/Instagram → số liệu.

Mã hiện chỉ chạy hai bước đầu: `MVP_STAGES = ['research', 'scripting']` (`apps/server/src/campaign/engine.ts:11`); ba bước còn lại bị đánh `skipped` khi bàn giao (`engine.ts` `activateCampaign`).

| # | Bước | Trạng thái | Căn cứ trong mã |
|---|---|---|---|
| 1 | Input sản phẩm (ảnh + mô tả) | **Đã có (qua chat Director)**; còn thiếu: ảnh chưa gắn vào Campaign như tài nguyên chuẩn để làm ảnh tham chiếu video | Tải ảnh PNG/JPEG/WebP/GIF ≤10 MB: `apps/server/src/http/uploads.ts:12-33`, route `POST /uploads` `apps/server/src/http/api.ts:117`; bảng `assets` `apps/server/src/db/schema.ts:75` có `kind/path/url` nhưng chưa thấy luồng gắn ảnh upload vào `assets` của Campaign (`Cần kiểm chứng` khi làm phiếu B/C) |
| 2 | Nghiên cứu | **Đã có** | Task `research.trend/competitor/audience`: `engine.ts:13`; kiểu nguồn `packages/domain/src/research.ts` |
| 3 | Kịch bản | **Đã có**: 3 kịch bản/vòng. Còn thiếu: kịch bản chưa bị ràng buộc độ dài ≤10 giây theo gói Pro | `SCRIPTS_PER_ROUND = 3` `engine.ts:14`; prompt Scriptwriter chỉ nói "video ngắn 9:16" `apps/server/src/agents/prompts.ts:9,121` |
| 4 | Duyệt kịch bản | **Đã có** (`choose_script`). Còn thiếu: nút "Tạo video bằng Gemini" ở bước duyệt này | `STAGE_GATE.scripting = 'choose_script'` `packages/domain/src/lifecycle/stage.ts`; xử lý `apps/server/src/campaign/approvals.ts:22`; UI `apps/web/src/ui/ApprovalPanel.tsx` |
| 5 | Video | **Còn thiếu hoàn toàn** (chỉ có khung): máy trạng thái `videoVersion` (`requested → awaiting_upload/rendering → ready/invalid → approved/rejected`), kiểu duyệt `make_video`/`approve_video`; chưa có provider, route tải video, kiểm tệp | `packages/domain/src/lifecycle/videoVersion.ts`, `approval.ts:6-9`; `uploads.ts` chỉ nhận ảnh; không có `ffmpeg`/`remotion` trong mã server/web (grep) |
| 6 | Duyệt video | **Còn thiếu** (chỉ có khung `approve_video`, chưa có UI/route phát video) | `STAGE_GATE.video = 'approve_video'`; không có component phát video trong `apps/web/src/ui` |
| 7 | Đăng | **Còn thiếu hoàn toàn**: có máy trạng thái bài đăng (`draft → … → published/draft_uploaded`, tự đăng lại ≤3 lần), chưa có OAuth, connector, lịch, bảng lưu tài khoản/token | `packages/domain/src/lifecycle/post.ts`; `schema.ts` không có bảng bài đăng/tài khoản xã hội (16 bảng) |
| 8 | Số liệu | **Còn thiếu hoàn toàn** | Bước `analytics` bị bỏ qua; chưa có mã đọc insights |

Kết luận: nền (Campaign, Approval, Event, Agent) đã đủ; việc còn lại là **bước 5–8** và **ràng buộc độ dài ở bước 3–4**.

## 2. Video

### 2.1 Giới hạn của app Gemini gói Pro (dữ liệu orchestrator, 2026-11-23)

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| Model trong app | App Gemini sinh video bằng "Gemini Omni 1.2 Flash"; trang hướng dẫn **không còn nói tới Veo**. Trang gói có nhắc "dùng thử Veo 3.1 Lite (giới hạn)". Hệ quả: nút trong web nên ghi "Gemini" (không ghi "Veo") | https://support.google.com/gemini/answer/16126339 ; https://gemini.google/subscriptions/ | Đã kiểm chứng 2026-11-23 |
| Độ dài | "Videos can be from 3 seconds to up to 10 seconds long or up to 15 seconds for users with an AI Ultra subscription" → **Pro tối đa 10 giây/clip**. Có tính năng "Extend the video length up to another 10 seconds" nhưng **không dùng** (D-2). **Trần của web = 10 giây** | https://support.google.com/gemini/answer/16126339 | Đã kiểm chứng 2026-11-23 |
| Tỉ lệ khung | Có chọn tỉ lệ trước khi tạo; prompt chữ mặc định ngang; nếu tải ảnh/video tham chiếu thì tỉ lệ theo tệp tải lên. **9:16 không được nêu rõ.** Khuyên: tải ảnh tham chiếu đã cắt 9:16 | https://support.google.com/gemini/answer/16126339 | Cần kiểm chứng (thử ở S3) |
| Tham chiếu | Tối đa 1 video và 5 ảnh; có thể yêu cầu sinh audio | https://support.google.com/gemini/answer/16126339 | Đã kiểm chứng 2026-11-23 |
| Hạn mức | Tính theo compute, làm mới mỗi 5 giờ tới hạn mức tuần; video tốn nhiều nhất; Pro gấp 4 lần mức chuẩn; **không công bố số video/ngày**. Cộng đồng báo ~3 video/ngày với Pro (không chính thức) | https://support.google.com/gemini/answer/16275805 | Số video/ngày: Cần kiểm chứng |
| Flow gói Pro | Truy cập Gemini Omni Flash, 1.000 tín dụng Flow/tháng; số tín dụng mỗi video không nêu | https://gemini.google/subscriptions/ | Số tín dụng/video: Cần kiểm chứng |
| Độ phân giải, watermark hiển thị, quyền dùng thương mại | Không nêu. SynthID là watermark ẩn của Google AI. Tài liệu: "Use your discretion before you rely on, publish, or use videos" | https://support.google.com/gemini/answer/16722517 | Cần kiểm chứng (điều khoản thương mại) |
| Hệ quả Reels Facebook | Reels tối thiểu 3 giây → clip 3–10 giây hợp lệ với Facebook; TikTok/Instagram: xem mục 3 | [platform-limits.md](../product/platform-limits.md) mục 3 | Đã kiểm chứng 2026-11-17 |

Lưu ý phân biệt: bảng Gemini Omni Flash **API** trong platform-limits.md (3–15 giây, 9:16 rõ ràng) là API trả phí → bị D-14 loại; **giới hạn áp dụng cho web này là của app Gemini gói Pro (10 giây)**.

### 2.2 Provider `manual` (mặc định, D-13)

Luồng đề xuất (backend dừng chờ người dùng, không bot điều khiển giao diện Gemini — D-13 đã loại vì rủi ro điều khoản):

1. **Duyệt kịch bản** (`choose_script`): cạnh nút chọn kịch bản có nút **"Tạo video bằng Gemini"**. Chọn kịch bản + bấm nút → tạo `videoVersion` `requested → awaiting_upload` (provider `manual`) và Approval `make_video`.
2. **Video Producer** (Agent, Claude Code) soạn **prompt video** đã tuân thủ: một clip duy nhất, **3–10 giây**, dọc 9:16, mô tả cảnh/chuyển động/âm thanh, danh sách ≤5 ảnh tham chiếu. Ngay khi sinh prompt, backend kiểm `độ dài ≤ 10` và từ chối/yêu cầu Agent viết lại nếu vượt (đây là chỗ thực thi "đừng vượt giới hạn Gemini Pro").
3. **Màn "Làm video ở Gemini"**: hiện prompt (nút Sao chép), ảnh tham chiếu đã cắt 9:16 (nút Tải xuống), nút **Mở app Gemini** (liên kết ngoài `https://gemini.google.com/app`, mở tab mới), kèm hướng dẫn: chọn tạo video, tỉ lệ 9:16, ≤10 giây, dán prompt, đính ảnh. Không thể truyền prompt qua URL vào Gemini — `Cần kiểm chứng` (chưa có nguồn nêu tham số URL); mặc định giả định phải sao chép/dán thủ công.
4. Người dùng tải tệp (MP4) lên web → backend **kiểm tệp** (xem dưới) → `ready` hoặc `invalid` (kèm lý do cụ thể, cho tải lại).
5. **Duyệt video** (`approve_video`): phát video trong web; Duyệt → `approved`; Từ chối → `rejected` + quay lại bước 2 (phiên bản mới, D-2).

**Kiểm tệp khi tải lên** (đã ghi ở D-13; cần công cụ đọc metadata, ví dụ `ffprobe` — **Cần kiểm chứng** cách cài và giấy phép, xem 2.3):

| Kiểm | Quy tắc đề xuất | Lý do |
|---|---|---|
| Thời lượng | 3 ≤ d ≤ 10 giây (có thể cho phép sai số nhỏ, ví dụ 10,2 giây; **ngưỡng cụ thể do phiếu B quyết**) | Trần Pro (16126339); Reels ≥3 giây |
| Tỉ lệ | Dọc 9:16 (sai số nhỏ). Nếu Gemini xuất ngang/khác tỉ lệ → báo `invalid` và gợi ý tạo lại với ảnh tham chiếu 9:16; **không** tự cắt ở MVP (hoặc cắt bằng ffmpeg là tuỳ chọn, hỏi người dùng — mục 6) | 9:16 là định dạng Reels/TikTok |
| Định dạng | MP4 (H.264) là tối ưu cho cả ba nền tảng; MOV/WebM chấp nhận được với TikTok (platform-limits mục 1) nhưng Facebook/Instagram khuyên MP4 | Giảm lỗi khi đăng |
| Kích thước tệp | Giới hạn đọc/ghi do mình đặt (cần số hợp lý cho clip ≤10 giây); giới hạn nền tảng: TikTok ≤4 GB; FB/IG dung lượng: Cần kiểm chứng | |

### 2.3 Provider `template` (dự phòng, D-13)

Dùng khi hết hạn mức Pro hoặc muốn tự động hoàn toàn: dựng video 9:16 từ ảnh sản phẩm + chữ + nhạc, bố cục do Agent viết (qua gói thuê bao, không thêm chi phí — D-14).

| Tiêu chí | Remotion | ffmpeg (CLI) |
|---|---|---|
| Cách làm | Dựng video bằng React/TypeScript (cùng stack D-10); Agent viết component | Agent viết lệnh/filter graph (`zoompan`, `drawtext`, `concat`, `amix`) |
| Phụ thuộc | Node + trình duyệt Chromium headless (tải về khi render) | Một nhị phân, cài qua Homebrew; không cần trình duyệt |
| Kiểm soát chữ/phụ đề tiếng Việt, kiểu dáng | Tốt (CSS/React, font tuỳ chọn) | Làm được nhưng khó viết/gỡ lỗi hơn, quản lý font thủ công |
| Rủi ro Agent viết sai | Lỗi biên dịch/render dễ thấy; xem trước được | Cú pháp filter dễ sai, lỗi khó đọc |
| Tốc độ/tài nguyên | Chậm hơn, nặng hơn (Chromium) | Nhanh, nhẹ |
| **Giấy phép** | **Cần kiểm chứng.** Chưa có nguồn trong phiên này; Remotion có giấy phép riêng (không phải MIT thuần) và có thể yêu cầu giấy phép trả phí tuỳ quy mô/mục đích — phải đọc https://www.remotion.dev/docs/license (chưa tra) trước khi phụ thuộc. Nếu cần trả phí → vi phạm D-14, loại | `Cần kiểm chứng`: giấy phép phụ thuộc cách biên dịch (LGPL/GPL) và codec (H.264 có thể có vướng bằng sáng chế khi phân phối); dùng bản cài sẵn cục bộ, không phân phối lại, ít rủi ro hơn — cần xác nhận ở https://ffmpeg.org/legal.html (chưa tra) |

**Đề xuất:** làm `template` bằng **ffmpeg trước** (ít phụ thuộc, không dính giấy phép thương mại nếu chỉ dùng cục bộ; ffmpeg cũng cần cho kiểm tệp ở 2.2 nên dùng chung); giữ Remotion là lựa chọn sau **nếu** giấy phép đạt D-14. Quyết định cuối: mục 6. `template` không phải ưu tiên ngay vì 10 giây/clip của Gemini Pro chưa kiểm chứng thực tế (S3).

Chất lượng `template` là slideshow chuyển động, không phải video sinh bằng AI — cần nói rõ với người dùng để kỳ vọng đúng.

## 3. Publish

Nguyên tắc chung (D-3, D-8, D-14): đăng **chỉ sau Approval `approve_publish`**; token lưu cục bộ (mã hoá/khoá tệp); mọi lệnh đăng ghi audit; hạn mức nền tảng được backend tự thực thi (không tin vào lỗi trả về).

### 3.1 Điều kiện chung để làm được

- **App developer miễn phí** ở TikTok for Developers và Meta for Developers (không tốn tiền; nhưng cần duyệt app — xem dưới).
- **Redirect OAuth về `localhost`:** web chạy cục bộ (D-8) → callback `http://localhost:<cổng cố định>/…`. Nền tảng có chấp nhận `localhost`/HTTP cho app ở chế độ phát triển hay bắt buộc HTTPS + domain đã xác minh: **Cần kiểm chứng cho từng nền tảng** (chưa tra trong phiên này; S2). Nếu bắt buộc HTTPS/domain → cần tunnel miễn phí (ví dụ Cloudflare quick tunnel — **Cần kiểm chứng** về giá/điều khoản) hoặc bước dán mã thủ công; không mua tên miền (D-14).
- **App review/audit** quyết định ai đăng được và đăng công khai hay không. Với một người dùng đăng lên tài khoản của chính mình, chế độ phát triển có thể đủ — **Cần kiểm chứng** (đặc biệt: vai trò Tester/Developer của Meta và người dùng sandbox của TikTok).

### 3.2 TikTok (Content Posting API)

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| OAuth, redirect `localhost` | Chưa tra yêu cầu redirect URI (HTTPS/localhost) | https://developers.tiktok.com/doc/content-posting-api-get-started | Cần kiểm chứng |
| App review / audit | Scope `video.publish` cần được duyệt; **app chưa audit: mọi bài bị giới hạn chế độ riêng tư (SELF_ONLY)**; hướng dẫn UX nêu tối đa 5 người dùng/24h với client chưa audit | https://developers.tiktok.com/doc/content-sharing-guidelines | Đã kiểm chứng 2026-11-17 |
| Cách gửi tệp | `FILE_UPLOAD` (chunk 5–64 MB, chunk cuối tới 128 MB, 1–1000 chunk, tuần tự) chạy được từ máy cục bộ. `PULL_FROM_URL` cần domain/URL prefix **đã xác minh** → không hợp D-14/D-8 → **chọn `FILE_UPLOAD`** | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | Đã kiểm chứng 2026-11-17 |
| Chế độ nháp (Upload) | Có chế độ đưa vào nháp để người dùng tự bấm đăng trong app TikTok (D-3). Endpoint/scope cụ thể của chế độ Upload chưa tra lại | https://developers.tiktok.com/doc/content-posting-api-get-started | Cần kiểm chứng |
| Direct Post (đăng công khai) | Gọi Query Creator Info trước; người dùng chọn privacy (không mặc định), Comment/Duet/Stitch mặc định không tick, toggle nội dung thương mại, câu đồng ý Music Usage; chỉ gửi nội dung sau khi người dùng đồng ý rõ ràng; có preview; không watermark | https://developers.tiktok.com/doc/content-sharing-guidelines | Đã kiểm chứng 2026-11-17 |
| Định dạng | MP4 (khuyên)/WebM/MOV; H.264 (khuyên)/H.265/VP8/VP9; 23–60 FPS; cạnh 360–4096 px; tối đa 4 GB; độ dài thật theo `max_video_post_duration_sec` của creator (clip ≤10 giây luôn hợp lệ — **suy luận** từ 10 phút tối đa qua API) | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | Đã kiểm chứng 2026-11-17 (phần suy luận: Cần kiểm chứng) |
| Rate limit | 6 request/phút/token cho `/v2/post/publish/video/init/` | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | Đã kiểm chứng 2026-11-17 |
| Nội dung AI | Bật cờ `is_aigc` cho video do Gemini sinh | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | Đã kiểm chứng 2026-11-17 |

**Đề xuất TikTok:** MVP đăng ở chế độ **Upload nháp** (khớp D-3, và vì app chưa audit nên Direct Post chỉ ra riêng tư dù sao); Direct Post công khai để sau khi app qua audit.

### 3.3 Facebook (Pages Reels)

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| OAuth, redirect `localhost` | Chưa tra (Facebook Login có thể cho phép `localhost` ở chế độ phát triển — chưa có nguồn) | https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived | Cần kiểm chứng |
| App review | `pages_manage_posts`, `pages_read_engagement` qua App Review; cần privacy policy, data deletion callback, screencast khi review. Khi tự dùng trên Page mình quản trị ở chế độ phát triển có thể không cần review | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Cần kiểm chứng |
| Đích | Chỉ đăng Reels lên **Facebook Page**, không lên trang cá nhân → người dùng cần có Page | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Cách gửi tệp | `POST /{page-id}/video_reels` `upload_phase=start` → upload tệp (hoặc URL công khai, không nhận URL fbcdn) tới `rupload.facebook.com` → `upload_phase=finish`. **Upload tệp trực tiếp chạy được từ máy cục bộ**, không cần URL công khai | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Chế độ nháp / lịch | `video_state` = `DRAFT` \| `SCHEDULED` \| `PUBLISHED`; có `scheduled_publish_time` (Meta tự lên lịch); cờ `is_ai_generated` | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Định dạng | `.mp4` (H.264/H.265; VP9, AV1 cũng được); 9:16; 1080x1920 khuyên dùng, tối thiểu 540x960; 24–60 fps; 3–90 giây; dung lượng tối đa không nêu | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 (dung lượng: Cần kiểm chứng) |
| Hạn mức | 30 bài đăng qua API/24 giờ | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |

**Lưu ý độ phân giải:** nếu Gemini Pro xuất dưới 540x960, Facebook sẽ từ chối → backend kiểm khi tải lên (độ phân giải Gemini chưa nêu: Cần kiểm chứng).

**Đề xuất Facebook:** đây là nền tảng **dễ nhất** để làm đầu tiên (upload tệp trực tiếp, có `DRAFT`/`SCHEDULED`, không cần domain).

### 3.4 Instagram (Reels qua Graph API)

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| OAuth, redirect `localhost` | Chưa tra | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |
| Loại tài khoản / app review | Chỉ tài khoản Instagram professional (Business/Creator); Advanced Access (App Review) cần khi phục vụ tài khoản không do mình sở hữu; Business Verification: trang không nêu | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 (Business Verification: Cần kiểm chứng) |
| Cách gửi tệp | `POST /<IG_ID>/media` `media_type=REELS` với `video_url` **công khai**; hoặc resumable upload **chỉ cho app dùng Facebook Login for Business**; sau đó kiểm `status_code` (khuyên mỗi phút, tối đa 5 phút) → `media_publish`. **Không có upload tệp thẳng từ máy cục bộ** theo cách thông thường | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 |
| Chế độ nháp | Trang publishing không nêu chế độ nháp/lịch của IG | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |
| Định dạng Reels (độ dài, dung lượng, codec, tỉ lệ) | Trang publishing không nêu | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |
| Hạn mức | Tài liệu mâu thuẫn 100 vs 50 bài/24 giờ → thiết kế theo 50 | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |

**Điểm nghẽn Instagram:** `video_url` phải công khai → app cục bộ **không có URL công khai** và D-14 cấm hosting/tên miền trả phí. Ba lối đi:

1. **Resumable upload** nếu dùng Facebook Login for Business (đúng với ràng buộc cục bộ nhất) — cần kiểm chứng tính khả dụng cho một người dùng ở chế độ phát triển.
2. **Tunnel miễn phí** tạm thời để Meta kéo tệp (`Cần kiểm chứng` giá/điều khoản; thêm độ phức tạp, mở cổng ra ngoài).
3. **Dự phòng thủ công:** web hiển thị caption + tệp để người dùng tự đăng trong app Instagram (không cần API; khớp "bước thủ công của người dùng" ở D-14).

**Đề xuất Instagram:** làm sau Facebook; bắt đầu bằng dự phòng thủ công (3), rồi thử (1) ở spike S2.

### 3.5 Số liệu (bước 8)

Đã có danh sách metric trong platform-limits.md (TikTok `view_count/like_count/…` cần scope đọc video — `video.list` còn Cần kiểm chứng; IG insights Reels; FB `video_insights`). Làm **cuối cùng**, sau khi đã có bài đăng thật; thu qua polling theo lịch cục bộ. Hạn chế đã biết: IG một số metric không có khi <100 followers, lưu tối đa 90 ngày (platform-limits mục 2).

## 4. Thứ tự phiếu triển khai đề xuất

| Thứ tự | Phiếu | Nội dung | Phụ thuộc | Quyết định liên quan |
|---|---|---|---|---|
| 1 | **Phiếu B — Nút chuyển sang Gemini + giới hạn độ dài** | Hằng số trần 10 giây; Scriptwriter/Video Producer bị ràng buộc ≤10 giây; nút "Tạo video bằng Gemini" ở duyệt kịch bản; màn Làm video ở Gemini (prompt, ảnh tham chiếu, mở app Gemini); `videoVersion` `awaiting_upload` | Không (mã hiện có) | D-13, D-2, D-14, D-3 |
| 2 | Phiếu C — Tải video + kiểm tệp + duyệt video | Route tải MP4; kiểm thời lượng/tỉ lệ/codec; `ready/invalid`; UI phát video và `approve_video`; bật `video` trong `MVP_STAGES` | B; công cụ đọc metadata (ffprobe) | D-13, D-2 |
| 3 | Phiếu S2 — Spike nền tảng (chỉ nghiên cứu/đăng ký) | Kiểm redirect `localhost`, app review, vai trò tester/sandbox, chế độ Upload nháp TikTok, resumable IG, điều khoản thương mại video Gemini | Không (chạy song song với B–C) | D-3, D-14 |
| 4 | Phiếu D — Nền Publish chung | Bảng tài khoản xã hội + token, OAuth localhost, bài đăng theo máy trạng thái `post`, Approval `approve_publish`, hạn mức, audit | C, S2 | D-3, D-8 |
| 5 | Phiếu E — Connector Facebook Reels | Upload tệp, `DRAFT`/`SCHEDULED`/`PUBLISHED` | D | D-3 |
| 6 | Phiếu F — Connector TikTok (Upload nháp) | `FILE_UPLOAD`, `is_aigc`, hiện trạng audit | D | D-3 |
| 7 | Phiếu G — Connector Instagram (thủ công → API) | Gói caption + tệp để đăng tay; sau đó resumable/tunnel nếu S2 cho phép | D, S2 | D-14, D-3 |
| 8 | Phiếu H — Provider `template` | ffmpeg trước, Remotion nếu giấy phép đạt | C | D-13, D-14 |
| 9 | Phiếu I — Số liệu | Polling insights, bảng số liệu, bước `analytics` | E–G | D-4, D-17 |

Phiếu H có thể đẩy lên sớm nếu thử thực tế (S3) cho thấy hạn mức Gemini Pro quá thấp.

## 5. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | Gemini xuất ngang hoặc không 9:16 (9:16 không được nêu rõ) | Cao | Ảnh tham chiếu 9:16; kiểm tệp báo `invalid`; thử thật ở S3 |
| R2 | Hạn mức Pro (không công bố số video/ngày; ~3/ngày không chính thức) làm chậm vòng duyệt/tạo lại | Trung bình | Hiện hạn mức còn lại không đọc được → hướng dẫn người dùng; provider `template` dự phòng |
| R3 | Điều khoản thương mại video Gemini + watermark SynthID chưa rõ khi đăng quảng cáo | Cao | Cần kiểm chứng trước khi đăng thật; bật cờ AI trên TikTok/Facebook |
| R4 | Tên model/sản phẩm đổi nhanh (Veo → Omni; đã có Sora 2, Veo 3.1 Preview ngừng — T9) | Trung bình | Nút ghi "Gemini"; adapter provider; không phụ thuộc UI của Gemini |
| R5 | OAuth redirect `localhost`/HTTPS không được chấp nhận | Cao | S2 kiểm trước; tunnel miễn phí hoặc dán mã thủ công |
| R6 | App TikTok chưa audit → chỉ đăng riêng tư | Trung bình | Dùng Upload nháp (D-3) |
| R7 | Instagram cần URL công khai | Cao | Resumable / tunnel / đăng tay (mục 3.4) |
| R8 | App review Meta/TikTok kéo dài hoặc bị từ chối (cần privacy policy, data deletion callback) | Trung bình | Dùng chế độ phát triển cho chính tài khoản người dùng nếu được (Cần kiểm chứng) |
| R9 | Giấy phép Remotion/ffmpeg không hợp D-14 | Thấp–TB | Dùng ffmpeg cục bộ; kiểm giấy phép trước khi thêm dependency |
| R10 | Token hết hạn, bài đăng lỗi giữa chừng | Trung bình | Làm mới token; máy trạng thái `post` có tự đăng lại ≤3 lần |

## 6. Câu hỏi cho người dùng

1. **Trần 10 giây:** chốt mọi video của web ≤10 giây (không extend, D-2)? Nếu sau này nâng gói Ultra thì đổi hằng số lên 15?
2. **Tên nút:** ghi "Gemini" (không "Veo") vì app hiện dùng Gemini Omni 1.2 Flash — đồng ý?
3. **Tỉ lệ sai:** nếu Gemini xuất không phải 9:16, web chỉ báo lỗi để tạo lại, hay được phép tự cắt/đệm bằng ffmpeg?
4. **Tài khoản:** bạn đã có Facebook Page (bắt buộc cho Reels), tài khoản Instagram Business/Creator, tài khoản TikTok chưa? Thứ tự nền tảng ưu tiên (đề xuất: Facebook → TikTok nháp → Instagram)?
5. **Instagram:** chấp nhận bước đăng tay (web chuẩn bị caption + tệp) ở MVP nếu API cần URL công khai?
6. **TikTok:** chấp nhận chế độ Upload nháp (bạn tự bấm đăng trong app TikTok)?
7. **Tunnel miễn phí:** có chấp nhận mở tunnel tạm thời ra internet cho OAuth/Instagram nếu `localhost` không đủ?
8. **Template:** làm provider `template` bằng ffmpeg trước, hay chờ kiểm giấy phép Remotion?
9. **Quyền thương mại:** bạn tự kiểm điều khoản Google về dùng video sinh từ app Gemini cho quảng cáo thương mại, hay để một spike kiểm?
