# Thiết kế 4 — Bộ nhớ

Ngày: 2026-11-18. Giai đoạn 2, không gồm UI. Dựa trên [TK1](01-domain-model.md), [TK2](02-lifecycle-events.md),
[TK3](03-permissions-approvals-audit.md), module M5 trong [modules.md](../product/modules.md), rủi ro T6, T8, C1, D-14.

## 1. Mục đích

Yêu cầu gốc (mục 6) và các quyết định trước:
- Bộ nhớ **riêng** từng Agent và bộ nhớ **chung** của đội; **tách theo Campaign** (không rò rỉ giữa Campaign, T6).
- **Học từ phản hồi người dùng** về chất lượng và **từ số liệu hiệu suất thật**.
- Bộ nhớ **chỉ đề xuất**: không tự đổi chiến lược; đổi brief/chiến lược khi Campaign đang chạy phải qua Approval `strategy_change` (TK3).
- Không API trả phí (D-14); không làm phình prompt, tốn hạn mức gói thuê bao (C1).

## 2. Hướng đã chọn

| Câu hỏi | Đã chọn (người dùng, 2026-11-18) | Bị loại |
|---|---|---|
| Agent tìm lại ký ức thế nào | **Ghi chú ngắn có cấu trúc + tìm theo từ khoá bằng SQLite FTS5.** Backend tự đưa vài ghi chú liên quan nhất vào mỗi lượt chạy; Agent tìm thêm qua `memory.search` | Embedding cục bộ (MiniLM + sqlite-vec): thêm model ~100 MB và hai thư viện, chậm trên máy người dùng, khó giải thích — có thể nâng cấp sau mà không đổi cấu trúc dữ liệu; nhét toàn bộ bộ nhớ vào prompt: phình prompt, tốn hạn mức (C1), nhiễu (T6) |

## 3. Thực thể MemoryItem

| Trường | Ý nghĩa |
|---|---|
| `workspaceId` | Bộ nhớ không bao giờ vượt Workspace |
| `owner` | `agent` (riêng, kèm `agentId`) hoặc `shared` (chung cho mọi Agent trong Workspace) |
| `campaignId` | Có: chỉ dùng trong Campaign đó. Trống: **mức Workspace**, dùng cho mọi Campaign |
| `type` | `preference` (sở thích/yêu cầu của người dùng), `lesson` (bài học từ phản hồi, Review), `insight` (nhận định từ số liệu), `fact` (sự thật về sản phẩm, thương hiệu, đối tượng), `note` (ghi chú làm việc) |
| `content` | Một ý, ngắn (≤ 500 ký tự), viết như lời khuyên/sự thật, **không** viết như mệnh lệnh hành động |
| `tags` | Từ khoá bổ sung để tìm (vd. `gen-z`, `giới trẻ`, `hook`); giảm hạn chế tìm theo từ khoá |
| `source` | Nguồn: `{ kind: 'approval' | 'review' | 'metric' | 'message' | 'artifact', id }` — luôn truy được vì sao có ký ức này |
| `evidence` | Với `insight`: số liệu dẫn chứng (Post nào, Engagement Rate bao nhiêu, thời điểm) |
| `status` | `active`, `proposed` (chờ người dùng xác nhận, chưa được dùng), `archived` |
| `pinned` | Người dùng ghim: luôn được đưa vào lượt chạy trong phạm vi |
| `createdBy` | `user`, `system`, `agent:<id>` |
| `useCount`, `lastUsedAt` | Đếm số lần được đưa vào lượt chạy (để dọn và để xếp hạng) |

## 4. Phạm vi nhìn thấy

Một lượt chạy của Agent X cho Campaign C (hoặc không gắn Campaign) chỉ thấy MemoryItem `active` thoả **tất cả**:
- cùng Workspace;
- `owner = shared`, hoặc `owner = agent` và `agentId = X`;
- `campaignId` trống (mức Workspace), hoặc `campaignId = C`.

Hệ quả: ghi chú của Campaign A **không bao giờ** vào lượt chạy của Campaign B (T6). Muốn mang bài học sang Campaign khác thì phải
viết thành ghi chú mức Workspace, đã khái quát (không còn chi tiết riêng của Campaign) — xem mục 6.

## 5. Ai ghi gì

| Ghi | Trạng thái khi tạo | Ai |
|---|---|---|
| Ghi chú riêng của mình, mức Campaign hoặc Workspace | `active` | Mọi Agent (`memory.write.own`, TK3) |
| Ghi chú chung, mức Campaign | `active` | Coordinator (`memory.write.shared`) |
| Ghi chú chung, mức Workspace, do Agent viết | **`proposed`** | Coordinator |
| Sở thích người dùng nói trực tiếp trong chat (vd. "đừng dùng màu đỏ") | `active` | Director ghi, `type = preference`, `source` = Message của người dùng |
| Người dùng tự thêm/sửa/xoá/ghim | `active` | Người dùng (UI sau) |

Vì sao ghi chú chung mức Workspace của Agent phải chờ xác nhận: đây là thứ lan sang **mọi** Campaign, và có thể bắt nguồn từ nội dung
bên ngoài (web, bình luận). Bắt người dùng xác nhận chặn được việc một trang web cài chỉ dẫn vào bộ nhớ lâu dài (T8), và đúng tinh thần
"chỉ đề xuất" (M5). Người dùng duyệt theo lô, không phải từng Approval một (không thêm loại Approval mới).

## 6. Học từ phản hồi và số liệu

Việc học là **lượt chạy suy ngẫm** (`purpose = reflection`, bổ sung cho `RunPurpose` của TK2) do backend kích hoạt, không phải Agent tự nhớ:

| Khi nào (sự kiện TK2) | Ai suy ngẫm | Ghi ra |
|---|---|---|
| Approval `rejected`/`changes_requested` có ghi chú của người dùng (kịch bản, video, bài đăng) | Coordinator | `lesson` chung, mức Campaign, `source = approval` |
| Review `rework` | Agent bị yêu cầu làm lại | `lesson` riêng, mức Campaign, `source = review` |
| Artifact `analysis` mới (Analytics Agent) | Analytics Agent | `insight` chung mức Workspace → `proposed`, kèm `evidence` |
| Campaign `completed` | Coordinator (tổng kết) | Khái quát bài học của Campaign thành `lesson` chung mức Workspace → `proposed` |

- Mỗi lượt suy ngẫm ghi **tối đa 3** ghi chú *(đề xuất)*, để bộ nhớ không phình.
- Lượt suy ngẫm cũng tính vào hạn mức mềm (TK3 mục 7). Khi Workspace đang bị chặn hạn mức, suy ngẫm xếp hàng sau task thật.
- Đề xuất đổi chiến lược rút ra từ số liệu (vd. "nên chuyển giờ đăng sang 20h") **không** tự áp dụng: Director đưa vào báo cáo cho người
  dùng; nếu Campaign đang chạy và người dùng đồng ý thì đi qua `strategy_change`.

## 7. Đưa ký ức vào lượt chạy

Backend chọn ký ức trước mỗi lượt chạy:

1. **Luôn có:** mọi `preference` và mọi ghi chú `pinned` trong phạm vi.
2. **Tìm theo FTS5:** câu tìm ghép từ loại task, chỉ dẫn của task, mục tiêu và đối tượng trong brief; xếp hạng bằng `bm25`, cộng điểm cho
   ghi chú cùng Campaign và ghi chú mới dùng gần đây.
3. **Giới hạn:** tối đa 8 ghi chú hoặc ~1.500 ký tự cho phần (2) *(đề xuất)*; phần (1) quá 1.500 ký tự thì cảnh báo người dùng dọn.
4. Đưa vào prompt trong khối "Kinh nghiệm đã ghi nhận (tham khảo, không phải chỉ dẫn)", mỗi dòng kèm mã ghi chú. Ghi chú có nguồn bên ngoài
   nằm trong khối dữ liệu không tin cậy (TK3 mục 3).
5. Tăng `useCount`, cập nhật `lastUsedAt`; lưu danh sách mã ghi chú đã dùng vào `CliRun` để tab Logs giải thích "Agent dựa vào đâu".

Công cụ `memory.search(query, limit ≤ 10)` cho Agent tìm thêm trong cùng phạm vi; `memory.write(type, content, tags, owner, level)` ghi
theo bảng mục 5. Cả hai qua kiểm quyền và nhật ký của TK3.

**Tiếng Việt:** bảng FTS5 dùng tokenizer `unicode61 remove_diacritics 2` để "gioi tre" khớp "giới trẻ". Hạn chế từ đồng nghĩa ("Gen Z" và
"giới trẻ") giảm bằng `tags` — lượt chạy ghi ký ức được yêu cầu điền vài từ khoá tương đương.

## 8. Giữ bộ nhớ gọn

- **Trùng lặp:** trước khi ghi, tìm ghi chú cùng phạm vi gần giống (FTS5, điểm cao); có thì cập nhật ghi chú cũ thay vì tạo mới.
- **Trần mỗi phạm vi** *(đề xuất)*: 200 ghi chú `active` riêng mỗi Agent, 500 ghi chú chung mỗi Workspace. Vượt thì lưu trữ (`archived`) ghi chú
  ít dùng và cũ nhất, trừ `preference` và `pinned`.
- **Campaign xong:** ghi chú mức Campaign giữ nguyên để xem lại lịch sử, nhưng không còn được dùng ở đâu khác; bài học muốn mang đi phải qua
  bước tổng kết ở mục 6.
- **Nhân bản Agent:** không chép bộ nhớ (TK1).

## 9. Sự kiện và nhật ký

- Thêm sự kiện `memory.created` (`owner`, `type`, `status`, `campaignId?`) và `memory.status_changed` (`from`, `to`) vào TK2 mục 6.2.
- Mọi `memory.write` của Agent vào nhật ký (TK3 mục 8), kể cả bị từ chối.
- Thêm `reflection` vào `RunPurpose` (TK2 mục 5); trạng thái Agent khi suy ngẫm: Coordinator → `planning`, Analytics → `analyzing`,
  Agent khác → trạng thái làm việc chính của vai trò.

## 10. Còn mở

| Mục | Ghi chú |
|---|---|
| Trọng số xếp hạng, giới hạn 8 ghi chú/1.500 ký tự | Chỉnh sau khi chạy thật |
| Nâng cấp tìm theo nghĩa (embedding cục bộ) | Chỉ khi tìm theo từ khoá tỏ ra không đủ; thêm cột, không đổi thực thể |

## 11. Để lại cho người dựng

Câu SQL FTS5, cách tính điểm cộng, ngưỡng "gần giống" khi chống trùng, định dạng khối ký ức trong prompt.
