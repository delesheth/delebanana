# Đăng Instagram Reels qua API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bài Instagram tự đăng qua Graph API (resumable upload) khi Page đã kết nối có tài khoản IG Business/Creator liên kết.

**Architecture:** Dùng chung app Meta + Page token. Khi lưu Page, tìm `instagram_business_account` và lưu thành social account con (`parentAccountId`). Lúc duyệt đăng, bài Instagram chuyển `mode='api'` nếu có tài khoản IG dùng được. Worker rẽ nhánh theo platform: container → upload → poll `status_code` → `media_publish`.

**Tech Stack:** TypeScript, Hono, drizzle-orm/SQLite, vitest, React.

**Spec:** `docs/superpowers/specs/2026-11-24-instagram-api-publish-design.md`

## Global Constraints
- Không SDK, không dịch vụ trả phí, không tunnel (D-14); mọi gọi mạng qua `MetaClient` tiêm được.
- Token không bao giờ vào lỗi/log/kết quả API (`scrub`).
- Hạn mức IG: 50 bài / 24 giờ cuốn chiếu mỗi tài khoản IG.
- Không gửi cờ AI cho IG (chưa kiểm chứng).
- Không commit (người dùng tự commit sau khi kiểm).

## Review Focus
- Restart sau khi đã gửi `media_publish` → không đăng lần hai (dấu `finishSentAt` ghi trước khi gọi).
- Restart sau khi tạo container nhưng chưa upload xong → upload lại vào cùng container (dấu `uploadedAt`).
- Container `ERROR`/`EXPIRED` → lỗi, Thử lại tạo container mới.
- Bài IG hẹn giờ mà máy tắt quá giờ → đăng khi bật lại và báo trễ.
- Ngắt kết nối Page → tài khoản IG con cũng bị ngắt; Page không có IG → IG vẫn đăng tay.

---

### Task 1: Domain + schema
**Files:** `packages/domain/src/publish.ts`, `apps/server/src/db/schema.ts`, migration mới `apps/server/drizzle/0010_*.sql` (qua `pnpm --filter @delebanana/server db:generate`).
- `IG_REELS_DAILY_LIMIT = 50`; `checkReelsSpec(probe, mime, label = 'Facebook Reels')` dùng `label` trong lý do.
- `SocialAccountRow.parentAccountId: string | null`.
- Cột `posts.uploaded_at` (integer), `social_accounts.parent_account_id` (text).

### Task 2: MetaClient — Instagram
**Files:** `apps/server/src/publish/meta.ts`, `meta.test.ts`, `apps/server/src/test/publishing.ts` (FakeMeta).
- `FB_SCOPES` thêm `instagram_basic`, `instagram_content_publish`; `IG_RUPLOAD_URL = https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}`.
- `getInstagramAccount(pageId, token): Promise<{ id: string; username: string } | null>` — `GET /{page}?fields=instagram_business_account{id,username}`.
- `createIgReel(igId, token, caption): Promise<{ containerId: string; uploadUrl?: string }>` — `POST /{ig}/media` form `media_type=REELS, upload_type=resumable, caption, share_to_feed=true`; trả `id`, `uri`.
- `uploadIgReel(containerId, token, file, uploadUrl?)` — POST stream, header `offset: 0`, `file_size`, `Content-Length`.
- `igContainerStatus(containerId, token): Promise<{ status: 'IN_PROGRESS'|'FINISHED'|'PUBLISHED'|'ERROR'|'EXPIRED'; error?: string }>` — `fields=status_code,status`.
- `publishIgReel(igId, token, containerId): Promise<string>` (media id) — `POST /{ig}/media_publish` `creation_id`.
- `igPermalink(mediaId, token): Promise<string | undefined>`.
- Tests: tham số/URL gửi đi đúng, không có token trong URL.

### Task 3: Accounts — liên kết IG
**Files:** `apps/server/src/publish/accounts.ts`, test mới `accounts.test.ts` (hoặc khối trong test hiện có).
- Sau mỗi `saveAccount` Facebook (callback 1 Page, `selectPage` — thành async, `connectWithToken`): `linkInstagram(workspaceId, fbAccountId, page token, meta)` gọi `getInstagramAccount`; có → upsert account `platform='instagram'`, `externalId=ig id`, `displayName='@username'`, `parentAccountId=fb id`, cùng token; không có → archive IG con cũ. Lỗi mạng khi tìm IG: bỏ qua (giữ Page).
- `disconnect` archive cả account con. `markExpired` của Page cũng đánh dấu con.
- Route `POST .../select` await `selectPage`.

### Task 4: Duyệt đăng + Thử lại + Bỏ
**Files:** `apps/server/src/campaign/publishing.ts`, `publishing.test.ts`.
- `usableAccount(tx, ws, platform, now)` (thay `usableFacebookAccount`, giữ tên cũ làm alias nếu cần).
- Duyệt có Instagram + có IG dùng được: kiểm `checkReelsSpec(..., 'Instagram Reels')`, set `mode='api'`, `socialAccountId=ig`; hẹn giờ chỉ cần ở tương lai; trạng thái: đăng ngay → `publishing`, hẹn giờ → `scheduled`. Không có IG → giữ `manual`.
- `retryPost`: IG không áp quy tắc 10 phút; `when.schedule` chỉ cần tương lai.
- `cancelPost`: cho bỏ bài IG api `scheduled` (chưa có container).
- `publishApprovalView`: thêm `instagramReady: boolean`, `instagramAccount?: string` (displayName).

### Task 5: Worker — nhánh Instagram
**Files:** `apps/server/src/publish/worker.ts`, `worker.test.ts`.
- `run(p)`: `platform==='instagram'` → `runInstagram`.
- Không container: kiểm spec; hạn mức 50/24h theo `apiCalledAt`; nếu `scheduledAt` và `now > scheduledAt + 5 phút` → `notifyDirector` báo trễ; set `apiCalledAt`; `createIgReel` → lưu `platformPostId`; upload → `uploadedAt`; poll tick sau.
- Có container: chưa `uploadedAt` → upload lại. `igContainerStatus`: `IN_PROGRESS` → chờ (timeout 1 giờ kể từ `apiCalledAt`); `ERROR/EXPIRED` → fail discard (xoá container, `uploadedAt`); `FINISHED` chưa `finishSentAt` (hoặc `finishRetriedAt >= finishSentAt`) → ghi `finishSentAt` → `publishIgReel` → `igPermalink` → published; `FINISHED` đã gửi publish → chờ, quá 1 giờ thì fail không discard; `PUBLISHED` → published.
- discard xoá thêm `uploadedAt`.
- Tests: luồng chuẩn, restart giữa chừng, ERROR→Thử lại tạo container mới, hạn mức, hẹn giờ trễ báo Director.

### Task 6: Giao diện + tài liệu
**Files:** `apps/web/src/live/api.ts`, `ui/PublishAccounts.tsx`, `ui/ApprovalPanel.tsx`, `ui/publishUi.ts`, `publishUi.test.ts`, `docs/guides/meta-app-setup.md`.
- PublishAccounts liệt kê IG con dưới Page ("Instagram @x"), báo khi Page chưa có IG.
- ApprovalPanel: IG ghi "tự đăng qua API (@x) — máy cần bật lúc tới giờ hẹn" khi `instagramReady`, ngược lại "đăng tay có hỗ trợ"; chặn nếu spec lỗi.
- `publishUi`: nhãn `scheduled` api Instagram "Chờ tới giờ đăng"; nút Bỏ cho bài đó.
- Guide: thêm quyền IG, bước liên kết IG với Page, cập nhật mục 8.
- Verify: `pnpm -r typecheck`, `pnpm vitest run`.
