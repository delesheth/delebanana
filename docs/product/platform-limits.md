# Giới hạn nền tảng và dịch vụ bên ngoài

> **Phạm vi kiểm chứng:** spike S1 (phần đối chiếu tài liệu) đã đối chiếu với tài liệu chính thức bằng tra cứu web ngày
> **2026-11-17**. **Người kiểm:** agent AI Claude chạy qua Bint (không phải người), kết quả chưa có người đối chiếu độc lập; người dùng duyệt các quyết định ở [roadmap.md](roadmap.md) mục 2 (ngày duyệt ghi ở tiêu đề mục đó), chưa xác nhận từng dòng bảng này. Dòng ghi `Đã kiểm chứng 2026-11-17` là giá trị lấy từ trang nguồn ghi ở dòng đó; dòng ghi `Cần kiểm chứng`
> là nguồn không nêu số, mâu thuẫn, chỉ có nguồn bên thứ ba, hoặc chưa tra lại. **Chưa thử thật** (spike S3) và **chưa qua
> app review** (spike S2): "Đã kiểm chứng" ở đây chỉ nghĩa là khớp tài liệu, không phải đã chạy thử. Không có con số nào
> ngoài những gì ghi trong bảng.

Trạng thái: `Đã kiểm chứng 2026-11-17` (người kiểm: agent AI Claude qua Bint, tra cứu web; khớp tài liệu chính thức ghi ở cột URL), `Cần kiểm chứng` (tài liệu không nêu số, mâu thuẫn, nguồn bên thứ ba, hoặc chưa tra lại).

## 1. TikTok — Content Posting API / Display API

Nguồn chung: [get-started](https://developers.tiktok.com/doc/content-posting-api-get-started), [Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post), [media transfer](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide), [content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines), [get user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info), [video object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object).

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| Quyền & app review | Scope `video.publish` (Direct Post); app phải được duyệt scope và người dùng phải uỷ quyền | https://developers.tiktok.com/doc/content-posting-api-get-started | Đã kiểm chứng 2026-11-17 |
| Query Creator Info | Phải gọi trước khi đăng; trả `privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec` | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | Đã kiểm chứng 2026-11-17 |
| App chưa audit | "All content posted by unaudited clients will be restricted to private viewing mode" (SELF_ONLY); hướng dẫn UX nêu tối đa 5 người dùng / 24h với client chưa audit | https://developers.tiktok.com/doc/content-sharing-guidelines | Đã kiểm chứng 2026-11-17 |
| Rate limit | "Each user access_token is limited to 6 requests per minute" cho `/v2/post/publish/video/init/` | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | Đã kiểm chứng 2026-11-17 |
| Giới hạn bài/ngày mỗi creator; giới hạn người dùng đăng hoạt động mỗi ngày của client | Có tồn tại (lỗi `spam_risk_too_many_posts`, `reached_active_user_cap`) nhưng tài liệu **không nêu con số** | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | Cần kiểm chứng |
| UX bắt buộc Direct Post | Hiện nickname creator; người dùng tự chọn privacy từ dropdown, **không có giá trị mặc định**; Comment/Duet/Stitch mặc định không tick; toggle nội dung thương mại (Your brand / Branded content; branded content không được private); hiện câu "By posting, you agree to TikTok's Music Usage Confirmation"; "must only start sending content materials to TikTok after the user has expressly consented to the upload"; có preview; không thêm watermark/logo quảng bá; báo người dùng việc xử lý mất vài phút | https://developers.tiktok.com/doc/content-sharing-guidelines | Đã kiểm chứng 2026-11-17 |
| Đăng tự động theo lịch | Tài liệu không nói rõ; nhưng các yêu cầu UX trên đòi hành động của người dùng cho từng bài → khớp D-3 (xác nhận từng bài, nếu thiếu thì Upload nháp) | https://developers.tiktok.com/doc/content-sharing-guidelines | Cần kiểm chứng |
| Nội dung AI | Cờ `is_aigc` (bool) đánh nhãn nội dung AI → nên bật cho video AI | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | Đã kiểm chứng 2026-11-17 |
| Định dạng video | MP4 (khuyên dùng)/WebM/MOV; H.264 (khuyên dùng)/H.265/VP8/VP9; 23–60 FPS; cạnh 360–4096 px; tối đa 10 phút qua API (giới hạn thật theo `max_video_post_duration_sec` của creator); tối đa 4GB | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | Đã kiểm chứng 2026-11-17 |
| Upload | Chunk 5–64MB (chunk cuối tới 128MB), 1–1000 chunk, upload tuần tự; `PULL_FROM_URL` cần domain/URL prefix đã xác minh | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | Đã kiểm chứng 2026-11-17 |
| Số liệu video | Video object có `view_count`, `like_count`, `comment_count`, `share_count` | https://developers.tiktok.com/doc/tiktok-api-v2-video-object | Đã kiểm chứng 2026-11-17 |
| Followers | User object `follower_count` (cùng `following_count`, `likes_count`, `video_count`), cần scope `user.info.stats` | https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info | Đã kiểm chứng 2026-11-17 |
| Scope đọc danh sách video | `video.list` (chưa xác nhận trong tài liệu đã tra) | https://developers.tiktok.com/doc/tiktok-api-v2-video-object | Cần kiểm chứng |
| Xu hướng | Research API chỉ cho học thuật/phi lợi nhuận; không có API thương mại chính thức cho xu hướng → D-4 | https://developers.tiktok.com/products/research-api/ | Cần kiểm chứng |

Chế độ Upload (vào nháp để người dùng tự đăng, dùng cho D-3): chưa tra lại trong lần đối chiếu này → Cần kiểm chứng (nguồn: https://developers.tiktok.com/doc/content-posting-api-get-started).

## 2. Instagram — Instagram Platform (Graph API)

Nguồn chung: [content-publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing), [insights](https://developers.facebook.com/docs/instagram-platform/insights), [media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights), [IG User](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/), [Business Discovery](https://developers.facebook.com/docs/instagram-api/business-discovery).

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| Loại tài khoản | Chỉ tài khoản Instagram professional (Business/Creator). Nếu Page liên kết đòi Page Publishing Authorization (PPA) thì bị chặn tới khi hoàn tất PPA | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 |
| Luồng Reels | `POST /<IG_ID>/media` với `media_type=REELS` (`video_url` công khai, hoặc resumable upload — chỉ cho app dùng Facebook Login for Business) → kiểm `status_code` (khuyên "once per minute, for no more than 5 minutes") → `POST /<IG_ID>/media_publish` | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 |
| Hạn mức đăng | Trang nêu "100 API-published posts within a 24-hour moving period" (kiểm qua `/<IG_ID>/content_publishing_limit`), nhưng cùng trang có câu khác nêu 50 bài/24h ở phần carousel → **mâu thuẫn trong tài liệu**; thiết kế theo mức thấp hơn (50) | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |
| Quyền (Instagram Login) | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 |
| Quyền (Facebook Login) | `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_read_engagement` (+ `ads_management`, `ads_read` nếu người dùng có vai trò Business Manager) | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 |
| Advanced Access / App Review | Cần Advanced Access (qua App Review) khi phục vụ tài khoản không do mình sở hữu | https://developers.facebook.com/docs/instagram-platform/content-publishing | Đã kiểm chứng 2026-11-17 |
| Business Verification | Trang không nêu | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |
| Thông số video Reels (độ dài, dung lượng, codec, tỉ lệ) | Trang publishing không nêu | https://developers.facebook.com/docs/instagram-platform/content-publishing | Cần kiểm chứng |
| Insights Reels | `comments`, `likes`, `saved`, `shares`, `reposts`, `reach` (ước tính), `views` (in development), `total_interactions` (in development), `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`, `crossposted_views`/`facebook_views`. `impressions` deprecated cho media tạo sau 2/7/2024 | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights | Đã kiểm chứng 2026-11-17 |
| Giới hạn insights | Số liệu người dùng lưu tối đa 90 ngày; một số metric không có với tài khoản < 100 followers; trả tập rỗng thay vì 0 | https://developers.facebook.com/docs/instagram-platform/insights | Đã kiểm chứng 2026-11-17 |
| Followers | Trường `followers_count` của IG User (public); Business Discovery lấy `followers_count`, `media_count` của tài khoản Business/Creator khác | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/ ; https://developers.facebook.com/docs/instagram-api/business-discovery | Đã kiểm chứng 2026-11-17 |
| Hashtag search | Giới hạn số hashtag khác nhau mỗi 7 ngày; không có API xu hướng Reels/trending audio (chưa tra lại) | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search | Cần kiểm chứng |

## 3. Facebook — Pages Reels publishing

Nguồn chung: [reels-publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing), [video_insights](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/), [insights](https://developers.facebook.com/docs/graph-api/reference/insights/).

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| Đích đăng | "You can only publish Reels to Facebook Pages" (không đăng lên trang cá nhân) | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Luồng | `POST /{page-id}/video_reels` `upload_phase=start` → upload tới `rupload.facebook.com` (file hoặc URL công khai; không nhận URL fbcdn) → `upload_phase=finish` với `video_state` = `DRAFT` \| `SCHEDULED` \| `PUBLISHED`; có `scheduled_publish_time` (Meta tự lên lịch được) và cờ `is_ai_generated` | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Quyền | Page access token của người dùng có task `CREATE_CONTENT`; `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Hạn mức | "Reels API is limited to 30 API-published posts within a 24-hour moving period"; Meta khuyên app tự thực thi giới hạn, nhất là bài lên lịch | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Định dạng video | `.mp4` khuyên dùng (H.264/H.265; VP9, AV1 cũng được); 9:16; 1080x1920 khuyên dùng, tối thiểu 540x960; 24–60 fps cố định; 3–90 giây (Reels dạng story tối đa 60 giây) | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Đã kiểm chứng 2026-11-17 |
| Dung lượng tối đa | Tài liệu không nêu | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Cần kiểm chứng |
| Số liệu video | `/{video-id}/video_insights` có `blue_reels_play_count` (không tính replay), `fb_reels_total_plays` (có replay), `post_video_followers`; vài metric chỉ chính xác khi người gọi là người tạo bài | https://developers.facebook.com/docs/graph-api/reference/video/video_insights/ | Đã kiểm chứng 2026-11-17 |
| Rate limit gọi API (Business Use Case) | Meta áp rate limit theo Business Use Case cho các lệnh gọi insights/token; chưa tra con số cho Page/Reels trong lần đối chiếu này (giữ lại từ bản cũ) | https://developers.facebook.com/docs/graph-api/overview/rate-limiting | Cần kiểm chứng |
| Page Insights | Nhiều metric bị khai tử trước 15/6/2026; danh sách metric hiện hành chưa chốt | https://developers.facebook.com/docs/graph-api/reference/insights/ | Cần kiểm chứng |
| App Review, privacy policy, data deletion callback, screencast | Giữ nội dung cũ (chung cho Meta: cần privacy policy, data deletion callback, screencast khi review; `pages_manage_posts`, `pages_read_engagement` qua App Review) | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Cần kiểm chứng |
| Token dài hạn | Token dài hạn hết hạn, cần luồng làm mới (giữ nội dung cũ) | https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived | Cần kiểm chứng |

## 4. Dịch vụ AI Video Generation

Đặc điểm chung: job bất đồng bộ (poll/webhook); giá tính theo giây video; kiểm duyệt có thể từ chối người thật/thương hiệu/logo;
khó giữ nhất quán sản phẩm giữa cảnh, chữ trong hình kém; URL kết quả có thể hết hạn nên backend phải tải về lưu.
Theo D-2: **độ dài video sản phẩm = giới hạn một lần sinh của model**, không ghép clip và không dùng tính năng extend.

**Thị trường biến động nhanh:** hai dịch vụ lớn đã ngừng trong vòng hai tháng (Sora 2 API ngừng 2026-09-24; Veo 3.1 Preview ngừng 2026-10-22). Đây là rủi ro đã xảy ra (xem T9 trong [risks.md](risks.md)) và củng cố hướng adapter đa provider, đã chốt ở D-13 trong [roadmap.md](roadmap.md) (MVP: provider `manual` dùng Veo trong app Gemini/Flow theo gói Pro, provider `template` dự phòng; API trả phí để sau).

| Dịch vụ | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| OpenAI Sora 2 API | **ĐÃ NGỪNG**: "shut down on September 24, 2026 and are no longer available"; "There is no one-to-one replacement API". Loại khỏi danh sách ứng viên. Ghi chú lịch sử: 720x1280, $0.10/giây trước khi ngừng | https://developers.openai.com/api/docs/models/sora-2 | Đã kiểm chứng 2026-11-17 |
| Google Veo 3.1 Preview (`veo-3.1-generate-preview`, `-fast-`, `-lite-`) | **ĐÃ NGỪNG** 2026-10-22 trên Gemini API; thay bằng Gemini Omni Flash (`gemini-omni-1.2-flash`) hoặc bản GA trên Gemini Enterprise Agent Platform | https://aistudio.google.com/docs/video | Đã kiểm chứng 2026-11-17 |
| Google Gemini Omni Flash (`gemini-omni-1.2-flash`) — tỉ lệ & độ dài | 9:16 và 16:9 (mặc định 16:9); 3–15 giây (mặc định 10; >15 lỗi); extend tới 30 giây tổng (**không dùng**, theo D-2); độ phân giải 360p, 720p (mặc định), 1080p/4k (upscale) | https://aistudio.google.com/docs/omni | Đã kiểm chứng 2026-11-17 |
| Gemini Omni Flash — đầu vào & đầu ra | Tối đa 6 ảnh tham chiếu (3 ảnh mỗi nhân vật, tối đa 2 nhân vật) — hữu ích giữ nhất quán sản phẩm; audio gốc; tệp >4MB dùng `delivery="uri"` và poll tới `ACTIVE`; SynthID watermark luôn có | https://aistudio.google.com/docs/omni | Đã kiểm chứng 2026-11-17 |
| Gemini Omni Flash — chính sách | Không hỗ trợ ảnh có một số người nổi tiếng; hạn chế ở EEA/Thuỵ Sĩ/UK (ảnh trẻ vị thành niên, sửa video tải lên); bộ lọc an toàn theo vùng | https://aistudio.google.com/docs/omni | Đã kiểm chứng 2026-11-17 |
| Gemini Omni Flash — thời gian lưu tệp, giá | Chưa có số trong nguồn đã tra | https://aistudio.google.com/docs/omni | Cần kiểm chứng |
| Gemini Omni Flash — billing | Gói Gemini Pro (thuê bao, dùng cho LLM qua Gemini CLI theo D-7) không thay thế billing của Gemini API cho video; **chưa có nguồn chính thức xác nhận** nên chưa có URL để dẫn — kiểm ở spike S3 | — (chưa có nguồn) | Cần kiểm chứng |
| Runway API — endpoint | `/v1/image_to_video`, `/v1/text_to_video`, poll `/v1/tasks/{id}`; là cổng nhiều model | https://docs.dev.runwayml.com/api/ | Đã kiểm chứng 2026-11-17 |
| Runway API — giá (USD/giây, theo trang models) | `gen4_turbo` $0.05/s (image-to-video); `gen4.5` $0.12/s; `kling3.0_standard` từ $0.09/s (3–15s, 720p); `kling3.0_pro` từ $0.12/s (3–15s, 1080p); `kling_4` từ $0.157/s (3–30s); `kling_4_flash` từ $0.094/s (3–20s); `seedance2_5` từ $0.20/s (4–30s); `veo3.1` từ $0.20/s; `veo3.1_fast` từ $0.10/s; `gemini_omni_flash_1.2` từ $0.02/s; `hailuo3` từ $0.10/s; `wan3` từ $0.05/s (2–30s) | https://docs.dev.runwayml.com/guides/models/ | Đã kiểm chứng 2026-11-17 |
| Runway API — tỉ lệ dọc từng model, thời hạn URL kết quả | Trang không nêu | https://docs.dev.runwayml.com/guides/models/ | Cần kiểm chứng |
| Kling (Kuaishou) trực tiếp | Tài liệu chính thức: endpoint video-omni có 9:16, 720p/1080p. Có thể dùng Kling qua Runway | https://kling.ai/document-api | Đã kiểm chứng 2026-11-17 |
| Kling trực tiếp — thời lượng | Chỉ thấy ở nguồn bên thứ ba (5 hoặc 10 giây); chưa có nguồn chính thức | https://kling.ai/document-api | Cần kiểm chứng |

### 4b. App Gemini gói Google AI Pro (provider `manual`, D-13)

Nguồn: orchestrator tra web **2026-11-23**. Đây là giới hạn áp dụng cho web (khác với bảng API trả phí ở trên, bị D-14 loại). Phân tích đầy đủ: [2026-11-23-next-steps-video-publish.md](../research/2026-11-23-next-steps-video-publish.md).

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| Model trong app | "Gemini Omni 1.2 Flash"; trang hướng dẫn không còn nói tới Veo; trang gói còn nhắc "dùng thử Veo 3.1 Lite (giới hạn)" | https://support.google.com/gemini/answer/16126339 ; https://gemini.google/subscriptions/ | Đã kiểm chứng 2026-11-23 |
| Độ dài | 3–10 giây; Ultra tới 15 giây → Pro tối đa 10 giây/clip; có extend thêm tới 10 giây (không dùng, D-2) | https://support.google.com/gemini/answer/16126339 | Đã kiểm chứng 2026-11-23 |
| Tỉ lệ khung | Chọn tỉ lệ trước khi tạo; prompt chữ mặc định ngang; ảnh/video tham chiếu thì theo tệp tải lên; 9:16 không nêu rõ | https://support.google.com/gemini/answer/16126339 | Cần kiểm chứng |
| Tham chiếu & audio | Tối đa 1 video + 5 ảnh; có thể yêu cầu sinh audio | https://support.google.com/gemini/answer/16126339 | Đã kiểm chứng 2026-11-23 |
| Hạn mức | Theo compute, làm mới mỗi 5 giờ tới hạn mức tuần; Pro gấp 4 lần mức chuẩn; không công bố số video/ngày (cộng đồng báo ~3/ngày, không chính thức) | https://support.google.com/gemini/answer/16275805 | Cần kiểm chứng (số video/ngày) |
| Flow gói Pro | Gemini Omni Flash, 1.000 tín dụng Flow/tháng; tín dụng/video không nêu | https://gemini.google/subscriptions/ | Cần kiểm chứng (tín dụng/video) |
| Độ phân giải, watermark hiển thị, quyền thương mại | Không nêu; SynthID là watermark ẩn; "Use your discretion before you rely on, publish, or use videos" | https://support.google.com/gemini/answer/16722517 | Cần kiểm chứng |

Giới hạn cần so sánh ở spike S3 (thử thật): chất lượng giữ nhất quán sản phẩm, xử lý ảnh tham chiếu sản phẩm, chữ trong hình, chính sách nội dung, quyền thương mại.
Luma và MiniMax Hailuo trực tiếp: chưa có URL chính thức đã xác minh (Hailuo có qua Runway ở bảng trên).

## 5. CLI gói thuê bao (Claude Code, Gemini CLI) — D-7

Chưa tra tài liệu chính thức trong đợt này; mọi dòng dưới đây là hạng mục cần kiểm chứng ở spike S5 (P8, C6, T10), chưa có số liệu hay URL nguồn.

| Hạng mục | Giá trị | URL nguồn | Trạng thái |
|---|---|---|---|
| Điều khoản dùng gói thuê bao Claude/Gemini Pro điều khiển CLI từ ứng dụng cục bộ | Chưa kiểm tra (P8) | — (chưa có nguồn) | Cần kiểm chứng |
| Hạn mức gói: số lượt, số tiến trình CLI song song, cửa sổ đặt lại | Chưa có số (C6) | — (chưa có nguồn) | Cần kiểm chứng |
| Cờ chế độ headless và định dạng đầu ra JSON/stream của Claude Code và Gemini CLI | Chưa tra; có thể đổi khi CLI nâng cấp (T10) | — (chưa có nguồn) | Cần kiểm chứng |
| Độ trễ khởi động mỗi lần chạy CLI | Chưa đo (S5) | — | Cần kiểm chứng |
