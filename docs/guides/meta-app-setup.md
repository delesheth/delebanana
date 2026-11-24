# Hướng dẫn: tạo app Meta để đăng Facebook Reels

Mục tiêu: cho Dele Banana đăng Reels lên **Facebook Page của bạn** (phiếu D) và lên **tài khoản Instagram Business/Creator liên kết với Page đó** (cùng app, cùng kết nối — mục 8). TikTok **không cần app** — web chỉ chuẩn bị caption + video để bạn tự đăng (mục 8b).

> **Đọc trước:** hướng dẫn này viết từ tài liệu Meta và `docs/product/platform-limits.md`, **chưa được chạy thử với app Meta thật** (giao diện Meta Developers đổi thường xuyên). Điểm nào chưa kiểm được ghi **Cần kiểm chứng**; có tổng hợp ở mục 10. Cập nhật 2026-11-24 theo thực tế một app Meta mới (giao diện tiếng Việt): ô URI chuyển hướng OAuth **không nhận `http://localhost`** và công tắc Thực thi HTTPS bị khoá bật (mục 2). Nếu bước nào khác với màn hình của bạn, dùng phương án dự phòng ở mục 6 (dán Page access token) — phương án đó không phụ thuộc vào Facebook Login và là cách chắc chắn chạy được.

Toàn bộ miễn phí: tạo app Meta ở chế độ Development không mất phí và không cần tên miền, tunnel hay dịch vụ trả phí (D-14).



## 0. Cần có sẵn

- Tài khoản Facebook là **admin** của Page muốn đăng (có quyền tạo nội dung — task `CREATE_CONTENT`).
- Đăng ký tài khoản nhà phát triển tại <https://developers.facebook.com> (đăng nhập bằng đúng tài khoản Facebook ở trên, xác minh số điện thoại/email nếu được hỏi).
- Dele Banana chạy trên máy bạn; server nghe `127.0.0.1` cổng **8787** (đổi bằng biến môi trường `PORT`; nếu đổi cổng thì mọi `8787` dưới đây phải đổi theo).

## 1. Tạo app (loại Kinh doanh)

1. Vào <https://developers.facebook.com/apps> → **Tạo ứng dụng** (Create App).
2. Chọn trường hợp sử dụng (use case) **Khác** (Other) → tiếp tục → chọn loại ứng dụng **Kinh doanh** (Business) → tiếp tục. *(Tên các lựa chọn Cần kiểm chứng: Meta đã đổi sang luồng "trường hợp sử dụng" nhiều lần.)*
3. Đặt tên app (ví dụ `Dele Banana của tôi`), email liên hệ → **Tạo ứng dụng**.
4. Để app ở chế độ **Phát triển** (Development) — công tắc **Chế độ ứng dụng: Phát triển / Chính thức** ở thanh trên cùng. **Đừng chuyển sang Chính thức (Live).**

## 2. Thêm sản phẩm Đăng nhập bằng Facebook

1. Menu trái → **Sản phẩm** → **Thêm sản phẩm** (Add Product; hoặc **Trường hợp sử dụng** → **Tùy chỉnh**) → chọn **Đăng nhập bằng Facebook** (Facebook Login) → **Thiết lập** (chọn nền tảng **Web**, bỏ qua phần mã mẫu).
2. Vào **Đăng nhập bằng Facebook → Cài đặt**, mục **Cài đặt OAuth ứng dụng**:
   - **Đăng nhập OAuth ứng dụng** (Client OAuth Login): bật.
   - **Đăng nhập OAuth trên web** (Web OAuth Login): bật.
   - **Thực thi HTTPS** (Enforce HTTPS): với app mới công tắc này **bật và bị khoá** (mờ, không tắt được) — đừng cố tắt.
   - **Chế độ sử dụng nghiêm ngặt cho URI chuyển hướng** (Strict Mode for Redirect URIs): cũng **bật và bị khoá**.
   - **URI chuyển hướng OAuth hợp lệ** (Valid OAuth Redirect URIs): ô này **từ chối URI `http`**, kể cả `http://localhost:8787/oauth/facebook/callback` (quan sát 2026-11-24, app mới).
   - Các công tắc còn lại (**Bắt buộc tái xác thực OAuth trên web**, **Đăng nhập OAuth được nhúng trên trình duyệt**, **Đăng nhập từ thiết bị**, **Đăng nhập bằng JavaScript SDK**) để **tắt**; ô **Miền được phép cho JavaScript SDK** để trống.
3. **Lưu thay đổi**.

### Đường đi đề xuất

- **(A) Để TRỐNG ô URI chuyển hướng**, Lưu, rồi thử mục 5 **Kết nối Facebook**. Meta được báo là cho `localhost` đi qua tự động khi app ở chế độ Phát triển, không cần khai trong danh sách (nguồn cộng đồng, thông báo Meta 2018). **Cần kiểm chứng** với app mới.
- **(B) Nếu Facebook báo *"URL blocked: This redirect failed because the redirect URI is not whitelisted"* / redirect_uri không hợp lệ** → dùng ngay **mục 6** (dán Page token): cách chắc chắn chạy được hôm nay, không cần sửa mã.

Ghi chú: phương án `https://localhost` bằng chứng chỉ tự ký (ví dụ mkcert) cần sửa server để nghe HTTPS — việc của phiếu sau, nếu bạn muốn. Hướng dẫn này không dùng tunnel.

## 3. Quyền cần có

Luồng đăng nhập xin năm quyền (ba quyền Page + hai quyền Instagram):

| Quyền | Dùng để |
|---|---|
| `pages_show_list` | liệt kê các Page bạn quản lý, lấy Page access token |
| `pages_read_engagement` | đọc thông tin Page và trạng thái bài (kiểm trạng thái xử lý Reels) |
| `pages_manage_posts` | đăng Reels lên Page |
| `instagram_basic` | đọc tài khoản Instagram liên kết với Page (id, username) |
| `instagram_content_publish` | đăng Reels lên tài khoản Instagram đó |

Ở chế độ **Phát triển**, người có vai trò **Quản trị viên/Nhà phát triển/Người thử nghiệm** của app dùng được các quyền này với tài khoản của chính mình mà **không cần Xét duyệt ứng dụng** (đủ cho việc bạn tự đăng lên Page của mình). Nếu tài khoản Facebook bạn dùng chưa phải admin của app: menu trái **Vai trò trong ứng dụng** → **Thêm người** thêm bạn (hoặc dùng đúng tài khoản đã tạo app).

**Cần kiểm chứng:** (a) chế độ Development đủ để đăng Reels bằng `pages_manage_posts` lên Page của chính admin app mà không cần App Review hay Business Verification; (b) Page của bạn không bị yêu cầu thêm bước nào (ví dụ Page Publishing Authorization) trước khi đăng qua API. Chưa có app thật nên chưa xác nhận. (c) Với app loại Kinh doanh theo luồng "trường hợp sử dụng", Graph API Explorer có liệt kê `pages_show_list` / `pages_read_engagement` / `pages_manage_posts` ngay không, hay phải thêm trước trường hợp sử dụng quản lý Trang (Page) ở **Trường hợp sử dụng** → **Tùy chỉnh** → **Quyền và tính năng**.

Muốn cho **người khác** (không phải admin/tester của app) dùng thì cần App Review + chuyển Live — ngoài phạm vi phiếu này.

## 4. Lấy App ID và App Secret, điền vào web

1. Trong app → **App settings → Basic**: sao chép **App ID**; bấm **Show** ở **App Secret** (nhập lại mật khẩu Facebook nếu được hỏi) rồi sao chép.
2. Mở web Dele Banana → thanh trái **Campaign** → kéo xuống cuối → mở **Kết nối tài khoản đăng bài** → mục *1. App Meta* → dán App ID, App Secret → **Lưu**.

Nơi lưu: bảng `platform_apps` trong SQLite của dữ liệu cục bộ (`~/Library/Application Support/DeleBanana/db.sqlite`, hoặc thư mục `DELE_DATA_DIR`), **ngoài repo** nên không bị commit. File này **không mã hóa** (máy một người dùng; D-8): đừng chia sẻ thư mục dữ liệu, đừng gửi nó cho ai. App Secret không bao giờ được gửi lại cho trình duyệt (màn hình chỉ biết "đã lưu"), không có trong nhật ký, sự kiện hay prompt của Agent. Nếu nghi lộ: **App settings → Basic → Reset** App Secret rồi nhập lại.

## 5. Kết nối bằng Facebook Login

1. Màn **Kết nối tài khoản đăng bài** → mục *2* → **Kết nối Facebook** (mở tab mới tới Facebook).
2. Đăng nhập, chọn các Page cho phép, đồng ý các quyền.
3. Facebook chuyển về `http://localhost:8787/oauth/facebook/callback`; trang báo "Đã kết nối" thì đóng tab. Nếu có nhiều Page, quay lại web và bấm tên Page muốn dùng.
4. Web đổi code → long-lived user token → Page access token của Page có quyền `CREATE_CONTENT`, lưu cục bộ. Mục trạng thái hiện "Đã kết nối · token không hết hạn · quyền dữ liệu còn N ngày".

Ghi chú về hạn: Page token lấy từ long-lived user token thường **không hết hạn**, nhưng Meta vẫn đặt hạn **truy cập dữ liệu** (khoảng 90 ngày kể từ lần đăng nhập gần nhất; **Cần kiểm chứng**). Khi tới hạn, trạng thái chuyển "hết hạn" và việc đăng bị chặn cho tới khi bạn kết nối lại.

## 6. Phương án dự phòng: dán Page access token (Graph API Explorer)

Dùng khi OAuth ở mục 5 không chạy (ví dụ Meta từ chối redirect localhost — đã gặp ở app mới, mục 2). Cách này không cần khai URI và không cần sửa mã.

1. Mở <https://developers.facebook.com/tools/explorer>.
2. Ô **Meta App** (Ứng dụng Meta) chọn app của bạn. Ô **User or Page** (Người dùng hoặc Trang) chọn **Get User Access Token** (Lấy mã truy cập người dùng); ở **Permissions** (Quyền) thêm `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` → **Generate Access Token** → đăng nhập, chọn Page, đồng ý. *(Explorer có thể hiện tiếng Anh dù Meta Developers đang tiếng Việt. Nếu không thấy ba quyền trong danh sách: xem Cần kiểm chứng (c) ở mục 3.)*
3. **Lấy token dài hạn trước** (token Explorer thường **hết hạn sau khoảng 1 giờ**): sao chép *user token* ở bước 2 → <https://developers.facebook.com/tools/debug/accesstoken> → dán → **Debug** → **Extend Access Token** (Gia hạn mã truy cập; long-lived, ~60 ngày) → sao chép token dài hạn mới.
4. **Gọi lại `me/accounts` bằng token dài hạn đó**: quay lại Explorer, dán token dài hạn vào ô **Access Token**, gõ `me/accounts` → **Submit**. Trong kết quả, tìm Page của bạn và sao chép giá trị **`access_token`** của Page đó (không phải token user). Page token lấy từ user token dài hạn thường **không hết hạn**; token lấy từ user token ngắn hạn thì sẽ hết hạn sớm. **Cần kiểm chứng** các con số thời hạn.
5. Web: **Kết nối tài khoản đăng bài** → *Hoặc dán Page access token* → dán → **Kiểm và lưu**.

Web gọi Graph API (`/me`, và `debug_token` nếu đã điền App ID/Secret) để kiểm token **trước khi lưu**: token sai, hết hạn hoặc không phải Page có quyền `CREATE_CONTENT` bị từ chối và không được lưu. Token không bao giờ hiện lại trên màn hình.

## 7. Giới hạn khi đăng Reels (web tự kiểm và tự đếm)

- Video: **MP4**, tỉ lệ **9:16** (có tính độ xoay), **3–90 giây**, tối thiểu **540×960**. Sai thì web không gọi API và nêu lý do cụ thể. Video MOV chỉ đăng tay được.
- Hạn mức **30 Reels qua API / 24 giờ cuốn chiếu cho mỗi Page** (web tự đếm; bài thứ 31 không gọi API, báo lỗi "hết hạn mức", bấm **Thử lại** sau khi hạn mức hồi).
- Lên lịch phía Meta: đặt giờ từ 10 phút đến 30 ngày tới (**Cần kiểm chứng** khoảng này); Meta giữ lịch nên máy không cần bật lúc đăng. Bài đã được Meta giữ lịch **không huỷ được từ web** — huỷ trong Meta Business Suite.
- Lỗi tạm thời (mạng, HTTP 5xx, mã giới hạn tốc độ) tự thử lại tối đa 3 lần; lỗi khác (token hết hạn mã 190, thiếu quyền mã 10/200, 4xx) dừng ngay ở "Lỗi" chờ bạn bấm **Thử lại** sau khi sửa nguyên nhân.
- Video do AI tạo: web gửi cờ `is_ai_generated` khi đăng (cờ có trong tài liệu Reels; **vị trí tham số Cần kiểm chứng** khi chạy thật).

## 8. Instagram Reels (tự đăng qua API)

Không cần app hay kết nối riêng: Instagram dùng chung app Meta và Page token ở mục 5/6.

1. **Chuyển tài khoản Instagram sang Business hoặc Creator** (app Instagram → Cài đặt → Loại tài khoản và công cụ) và **liên kết với Facebook Page** (Meta Business Suite → Cài đặt → Tài khoản Instagram, hoặc Page → Cài đặt → Tài khoản đã liên kết).
2. **Kết nối lại Page** (mục 5, hoặc dán lại token mục 6) để token có thêm `instagram_basic`, `instagram_content_publish`. Web tự tìm tài khoản IG của Page và hiện "Instagram @tên — liên kết với Page …" trong **Kết nối tài khoản đăng bài**.
3. Từ đó, khi **Duyệt đăng**, bài Instagram ghi "tự đăng qua API (@tên)". Web tạo bài chờ ở Instagram, **tải video thẳng từ máy** (resumable upload, không cần URL công khai hay tunnel), đợi Instagram xử lý, rồi đăng và lưu link bài.

Ghi chú:
- **Hẹn giờ:** Instagram không cho hẹn giờ qua API, nên **máy này tự đăng đúng giờ — Dele Banana phải đang chạy lúc đó**. Máy tắt thì khi bật lại web đăng ngay và báo trễ trong chat Director. Bài hẹn giờ Instagram **bỏ được** từ web cho tới lúc bắt đầu đăng.
- Video: cùng kiểm như Facebook Reels (MP4, 9:16, 3–90 giây, ≥540×960). Hạn mức web tự đếm: **50 bài / 24 giờ** mỗi tài khoản IG (tài liệu Meta ghi lúc 50 lúc 100 — lấy mức thấp).
- Ngắt Page → ngắt luôn Instagram. Token Page hết hạn → Instagram cũng hết hạn.
- Page chưa liên kết IG (hoặc token thiếu quyền) → Instagram vẫn **đăng tay có hỗ trợ** như mục 8b.
- Chưa gửi cờ "nội dung do AI tạo" cho Instagram (chưa xác minh được tham số qua API) — tự bật nhãn AI trong app Instagram nếu cần.

## 8b. TikTok (đăng tay có hỗ trợ)

Không cần app, không cần kết nối. Sau khi bạn bấm **Duyệt đăng**, bài TikTok (và Instagram nếu chưa liên kết) ở trạng thái **Chờ bạn đăng** trong mục *Bài đăng* của chiến dịch:

1. **Sao chép caption** → 2. **Tải video xuống** → 3. **Mở trang đăng** (Instagram: `instagram.com`; TikTok: `tiktok.com/tiktokstudio/upload` — **Cần kiểm chứng** URL còn đúng) → tự đăng → 4. bấm **Đã đăng** (dán link bài nếu muốn) hoặc **Bỏ**.

Nếu chọn giờ hẹn thì web chỉ **nhắc một lần** khi tới giờ (thông báo trong chat Director), không tự đăng.

## 9. Ghi chú trước cho app TikTok (làm ở phiếu sau)

Chưa cần làm gì bây giờ. Để chuẩn bị: tạo app tại <https://developers.tiktok.com> (miễn phí), thêm sản phẩm **Content Posting API**. Theo `docs/product/platform-limits.md` mục 1: Direct Post cần scope `video.publish` và app phải qua **audit**; app chưa audit chỉ đăng được ở chế độ riêng tư (SELF_ONLY); chế độ Upload (vào nháp để tự đăng) **Cần kiểm chứng**. Redirect URI của TikTok có thể đòi HTTPS (**Cần kiểm chứng**) — phiếu TikTok sẽ quyết định cách xử lý; phiếu D không dùng tunnel.

## 10. Tổng hợp các điểm Cần kiểm chứng

| # | Điểm | Nếu sai thì |
|---|---|---|
| 1 | **Đã kiểm:** ô URI từ chối `http://localhost` (2026-11-24, app mới; Thực thi HTTPS bị khoá bật). **Còn mở:** để trống ô URI thì Meta có tự cho `localhost` ở chế độ Phát triển không | dùng mục 6 (dán Page token) |
| 2 | Development đủ để đăng Reels lên Page của chính admin app, không cần App Review/Business Verification | cần App Review hoặc đăng tay |
| 3 | Tên/đường đi các màn hình tạo app (Business, use case, Facebook Login) | làm theo màn hình thật; mục 6 không phụ thuộc |
| 4 | Thời hạn token Explorer (~1 giờ), long-lived user token (~60 ngày), hạn truy cập dữ liệu (~90 ngày) | trạng thái trong web hiển thị theo `debug_token` |
| 5 | Khoảng giờ hẹn Facebook (10 phút – 30 ngày) | sửa `FB_SCHEDULE_MIN_MS/MAX_MS` trong `packages/domain/src/publish.ts` |
| 6 | Mã lỗi coi là tạm thời (1, 2, 4, 17, 32, 341, 368, 613) và cấu trúc trạng thái Reel | sửa hằng số trong `apps/server/src/publish/meta.ts` |
| 7 | Vị trí tham số `is_ai_generated`; phiên bản Graph API `v23.0` | đổi `SEND_AI_FLAG`/`GRAPH_VERSION` trong `meta.ts` |
| 8 | URL trang đăng Instagram/TikTok | sửa `MANUAL_POST_URLS` trong `packages/domain/src/publish.ts` |
| 9 | Hành vi với Page cần Page Publishing Authorization | hoàn tất PPA theo thông báo của Meta |
| 10 | Instagram: chế độ Development đủ để đăng lên IG của chính admin app; resumable upload `rupload.facebook.com/ig-api-upload` nhận Page token; dạng `status_code` | sửa `IG_RUPLOAD_URL`/`parseIgStatus` trong `meta.ts`; hoặc để Instagram đăng tay (ngắt liên kết) |
| 11 | Hạn mức Instagram 50 hay 100 bài/24 giờ | sửa `IG_REELS_DAILY_LIMIT` trong `packages/domain/src/publish.ts` |
