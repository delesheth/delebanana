# Đăng Instagram Reels qua API — thiết kế (ngắn)

**Ngày:** 2026-11-24 · **Trạng thái:** người dùng đã duyệt.

## Mục đích
Sau khi duyệt đăng, bài Instagram được tự đẩy lên qua API như Facebook, không phải tải video về đăng tay. TikTok để sau (vẫn đăng tay).

## Mục tiêu / không làm
- Có: đăng Reels lên tài khoản IG Business/Creator liên kết với Page đã kết nối; tự thử lại lỗi tạm thời; không đăng trùng; hạn mức tự đếm.
- Không: Instagram Login riêng, tunnel/URL công khai, TikTok API, số liệu insights.
- Phản mục tiêu: đăng trùng bài khi restart/Thử lại; lộ token trong log/lỗi.

## Ràng buộc
D-14 (miễn phí, không tunnel), D-8 (cục bộ một người dùng), app Meta chế độ Development.

## Cách làm (đã chọn)
| Cách | Đánh đổi | Chọn |
|---|---|---|
| Dùng chung app Meta + Page token, resumable upload (`rupload.facebook.com/ig-api-upload`) | Thêm 2 quyền, phải kết nối lại một lần | **Có** |
| Instagram Login riêng | Thêm luồng OAuth, vẫn vướng redirect localhost | Không |
| `video_url` công khai | Cần tunnel (trái D-14) | Không |

## Thiết kế
1. **Kết nối:** `FB_SCOPES` thêm `instagram_basic`, `instagram_content_publish`. Khi lưu Page (OAuth hoặc dán token), gọi `/{page}?fields=instagram_business_account{id,username}`; có thì lưu social account `platform='instagram'` (externalId = IG user id), dùng chung Page token. Không có IG → Instagram vẫn đăng tay.
2. **Chế độ bài:** `mode='api'` cho instagram khi có tài khoản IG đã kết nối, ngược lại `manual`.
3. **Đăng (worker):** tạo container `POST /{ig}/media` (`media_type=REELS`, `upload_type=resumable`, `caption`, `share_to_feed=true`) → lưu container id → POST tệp tới `uri` trả về → hỏi `status_code` (IN_PROGRESS/FINISHED/ERROR/EXPIRED) → ghi dấu `finishSentAt` rồi `POST /{ig}/media_publish` → lấy `permalink`. Có container id thì hỏi trạng thái trước; đã gửi publish thì không gửi lại.
4. **Kiểm & hạn mức:** dùng lại kiểm thông số Reels (MP4, 9:16, 3–90 s, ≥540×960); hạn mức 50 bài/24 giờ cuốn chiếu mỗi tài khoản IG.
5. **Giờ hẹn:** IG không hẹn giờ qua API → bài nằm `scheduled` cục bộ, tới giờ worker chuyển `publishing` và đăng. Máy tắt lúc tới giờ → bật lại thì đăng ngay và báo trễ trong chat Director.
6. **UI & tài liệu:** màn Kết nối tài khoản hiện tài khoản IG liên kết; cập nhật `docs/guides/meta-app-setup.md`.

## Cần kiểm chứng
Cờ AI qua IG API (không có thì bỏ); Development đủ để đăng IG không cần App Review; dạng phản hồi resumable upload.

## Để người làm tự quyết
Cách tách mã connector IG trong `meta.ts`/worker, tên hằng số, chi tiết hiển thị UI.
