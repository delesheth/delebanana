# Spike S4 — Văn phòng 3D (nền cho M12)

Ngày: 2026-11-17. Nguồn: roadmap.md (S4), boundaries.md (mục 2), D-5, D-6, D-11, D-12.

## Mục đích
Prototype văn phòng isometric bằng three.js + React Three Fiber + drei để **đo FPS khi đông nhân vật** và đánh giá
phong cách stylized/low-poly. Mã là **nền cho M12** (người dùng chọn), không phải bản bỏ đi.

## Mục tiêu
- Scene isometric (camera orthographic), bố cục cố định 6 khu: Research, Creative, Scriptwriting, Video Studio,
  Meeting Room, General Workspace (có bàn Director cố định, không phải khu thứ bảy).
- Nhân vật và nội thất stylized low-poly từ bộ asset CC0 của Kenney; ngoại hình = chọn 1 trong 13 nhân vật.
- Nhân vật đổi khu và animation **chỉ khi trạng thái đổi** (ánh xạ trạng thái → khu → animation của boundaries.md).
- Chỗ ngồi theo lưới bàn mỗi khu; khu đầy thì ngồi General Workspace kèm nhãn phòng ban (D-6).
- Bảng đo: FPS, draw calls, số nhân vật; thanh chỉnh số Agent (đến vài trăm); bật/tắt chuyển động trang trí;
  chế độ dựng chi tiết (mỗi nhân vật một nhóm mesh) vs instanced (gộp, D-5) để so sánh.
- Click nhân vật → bảng thông tin (tên, vai trò, trạng thái, khu) — chỗ giữ cho bảng 5 tab sau này.

## Không làm
- Không có backend, Event Bus thật, LLM. Trạng thái do **bộ giả lập** phát sự kiện có số thứ tự.
- Không dựng bảng 5 tab, Dashboard, tùy chỉnh ngoại hình qua UI, pathfinding thật (đi thẳng qua hành lang).

## Phản mục tiêu
- Nhân vật đi lại/gõ phím khi trạng thái không tương ứng (vi phạm boundaries.md).
- Kiểu trạng thái nằm riêng trong frontend, khiến backend sau này phải định nghĩa lại.

## Hướng đã chọn (người dùng chọn 1A; phần hình chuyển từ 2A sang asset Kenney)
| | Đã chọn | Bị loại |
|---|---|---|
| Cấu trúc | **pnpm workspace**: `apps/web` (Vite + React + R3F), `packages/domain` (kiểu trạng thái, bảng trạng thái → khu → animation, sự kiện có số thứ tự, reducer) — backend dùng lại | Một app ở gốc `src/`: phải tách lại khi có backend |
| Nhân vật & nội thất | **Asset CC0 của Kenney** (Mini Characters 2.0, Furniture Kit 2.0; `apps/web/public/models`, kèm License.txt). Đổi ngày 2026-11-17 sau khi người dùng xem bản khối cơ bản và đánh giá xấu | Khối cơ bản + animation bằng code (bản đầu): thô, khó đạt độ đẹp của asset do họa sĩ làm |

D-12 thực hiện cùng đợt: bỏ `package-lock.json`, commit `pnpm-lock.yaml`, script `test` = `vitest run`.

## Thiết kế
- `packages/domain`: `AgentState`, `ZoneId`, `STATE_BEHAVIOR` (state → zone/anim/workAnim), `AgentEvent {seq, agentId, state, at}`,
  `applyEvent` bỏ sự kiện cũ/trùng theo `seq`, `applySnapshot` cho đồng bộ lại (rủi ro T4). Có kiểm thử vitest.
- `apps/web/src/office/layout.ts`: toạ độ 6 khu, lưới bàn, `assignSeats` (thuần, có kiểm thử): Director ở bàn cố định;
  Agent vào khu đích, khu đầy → General Workspace + nhãn phòng ban.
- Di chuyển: lerp theo đường gấp khúc qua hành lang, tốc độ cố định; tới nơi mới chạy animation công việc.
- Nhân vật: mỗi Agent một `Avatar` (bản sao model + `AnimationMixer`), trạng thái → clip Kenney (`office/clips.ts`:
  idle, walk, sit, interact, holding, emote…) kèm lớp chỉnh xương cho động tác không có clip (gõ phím, đọc).
  Chế độ chi tiết vẽ SkinnedMesh; chế độ instanced tách mesh theo xương (mọi đỉnh gắn cứng một xương)
  thành bộ phận cứng, mỗi (model, bộ phận) một `InstancedMesh`, dùng chung animation.
- Nội thất: `KitInstances` gộp mỗi model Kenney thành InstancedMesh theo vật liệu; hướng model suy từ hình học
  (lưng ghế ở -Z; mặt màn hình và ngăn kéo bàn ở +Z).

## Để lại cho người dựng
Kích thước khu, màu sắc, chi tiết animation, ngưỡng tự chuyển sang instanced.

## Điều chỉnh 2026-11-18: phong cách hình ảnh theo văn phòng 3D của bflow
Người dùng thấy văn phòng của bflow "hợp lí, sắc nét và sinh động hơn". Chỉ **tham khảo ý tưởng** (bflow là AGPL-3.0, không chép mã
hay model); asset Kenney CC0 giữ nguyên.
- Camera: bỏ orthographic isometric, dùng **phối cảnh FOV 38°, nhìn từ phía nam, nghiêng 40°**; khung mặc định vừa cả tòa nhà
  (tính theo mép sàn gần camera); sương mờ nhẹ theo khoảng cách.
- Vỏ tòa nhà (`scene/Building.tsx`, thay sàn/tường Kenney): tường ngoài cao 3 m (bắc, tây, đông) ốp lam, cửa sổ, đèn hắt; mặt nam để
  trống; vách 1,1 m quanh mỗi phòng, **cửa rộng 2 m giữa vách giáp hành lang**; sàn thảm mỗi phòng một màu; bảng tên phòng chữ hoa
  nền tối (thay nhãn DOM); quầng sáng ấm trên sàn.
- Đường đi (`corridorPath`): rời chỗ theo khe giữa cột bàn ra lối đi cạnh cửa, qua cửa ra hành lang, vào cửa phòng đích; ở phòng
  họp đi vòng ngoài bàn tròn. Kiểm thử: chỉ băng qua vách ở khe cửa.
- Nhãn "Tên · trạng thái" trên đầu Director, Coordinator và nhân vật đang chọn; HUD viền đậm, nền kem, chữ monospace.

## Điều chỉnh 2026-11-18 (2): mặt bằng mới, phòng Giám đốc, lối đi thật
Phản hồi của người dùng: quá nhiều module General Workspace, quá nhiều bàn, thiếu phòng Giám đốc, đồ đạc phải kê cân xứng,
phòng họp ở trung tâm có 4 cửa, Agent không được đi xuyên đồ vật, màu hiện đại, mỗi phòng một kiểu máy tính. Người dùng chọn
bố cục A:

| | Tây | Giữa | Đông |
|---|---|---|---|
| Bắc (tường cao) | Research: 6 bàn lớn gỗ óc chó, màn siêu dài, ghế đen | **Director Office**: bàn lớn, laptop, ghế da, sofa tiếp khách | Scriptwriting: 6 bàn, 2 màn hình, ghế da cao cấp |
| Giữa | Creative: 4 bàn trắng, máy all-in-one, ghế vàng, bảng trắng | **Meeting Room** (tâm, cửa B/Đ/N/T, 8 ghế) | General Workspace: bàn Coordinator + 4 bàn |
| Nam (để trống phía camera) | Video Studio: phông xanh, bục sản phẩm, máy quay, 2 softbox, kệ sản phẩm, 2 bàn dựng | lối vào | **Lounge**: sofa, ghế bành, bàn đứng, quầy cà phê |

- `office/plan.ts` (thuần dữ liệu): phòng, cửa, hành lang, đồ đạc kèm vùng chiếm chỗ, chỗ ngồi (`posture` ngồi/đứng,
  `approach` = điểm đứng trên lối đi). Mọi phòng kê đối xứng qua trục giữa (trừ phòng quay và hàng bàn Coordinator).
- Director luôn ở phòng Giám đốc (bàn Director là `director_desk`; domain không đổi, vẫn 6 khu).
- Agent rảnh (`idle`) tới General Workspace như domain quy định nhưng ngồi ở **Lounge** (xem Điều chỉnh (8): `offline` ngồi tại bàn của mình) (thuộc khu General Workspace),
  không chiếm bàn. Roster 24 Agent rảnh cùng lúc vừa tòa nhà chính; module bàn (D-6) chỉ mở khi cả bàn lẫn Lounge đầy, đặt ở
  hàng phía nam. HUD chỉ còn 6/12/18/24 Agent.
- `office/walk.ts`: lưới 0,25 m, vật cản nới theo bán kính nhân vật, A* 8 hướng không cắt góc rồi kéo thẳng. Kiểm thử: mọi
  cặp chỗ ngồi có lối, không đoạn nào chạm vật cản hay băng qua vách ngoài khe cửa.
- Bàn, máy tính, ghế, sofa, thảm, đồ phòng quay dựng bằng khối (`scene/Furniture.tsx`, gộp InstancedMesh theo hình + vật liệu);
  Kenney chỉ còn cây, kệ sách, bàn trà, quầy cà phê. Vách kính khung đen, tường trắng ấm.

## Điều chỉnh 2026-11-18 (3): trang phục nhân vật, phòng quay, pub, phòng họp phi thuyền
- Nhân vật (`office/appearance.ts`, `scene/outfit.ts`): Giám đốc dùng nguyên model vest đen cà vạt đỏ (`male-d`). Nhân viên ghép
  đầu Kenney (mặt, tóc) với thân "may" lại: tô màu theo vùng xương (giày, quần, áo, tay áo dài/ngắn, bàn tay theo màu da của đầu)
  và phụ kiện gắn xương (cổ áo, nẹp cúc, túi, cà vạt, gi-lê, khăn, xích, mũ, kính, tai nghe), gộp một mesh mỗi xương. Mỗi người
  một bộ và một dáng (cao/ngang); 24 người đầu không trùng; roster 6 người đã có cowboy (mũ rộng vành, gi-lê da, ủng) và hiphop
  (mũ lưỡi trai, polo rộng, xích vàng). Chế độ instanced (> 120 Agent) vẫn vẽ thân Kenney gốc.
- Research: màn hình và bàn phím màu bạc. Creative: bàn gỗ sáng, máy all-in-one trắng.
- Video Studio: bỏ 2 bàn và chậu cây; tường đông là dãy kệ sản phẩm; sofa vòng cung quay về khu quay, bàn nước tròn ở giữa
  (4 chỗ ngồi + người đứng máy quay).
- Lounge thành pub ("Lounge Bar"): quầy bar 6 m, kệ rượu, biển neon, ghế bar cao, 2 booth ghế da, bàn bi-a, 2 bàn đứng, jukebox.
  Ghế bar có `seatHeight` riêng để nhân vật ngồi đúng độ cao.
- Phòng họp kiểu phi thuyền: bệ tròn tối viền đèn xanh, bàn trắng bóng có vòng sáng, máy chiếu hologram, 8 ghế vỏ trứng chân chrome.
- Bỏ mọi chậu cây nhỏ; ghế văn phòng chân sao 5 cánh chrome.

## Điều chỉnh 2026-11-18 (4): phòng quay cân đối, quầy bar tròn, người pha chế, nâng cấp nội thất
- Video Studio: dãy kệ tường đông căn giữa chiều sâu phòng; sofa vòng cung bán kính 3,5 m (13 khối) trải gần hết chiều ngang
  phòng, chừa lối ở hai đầu và sau lưng (≈ 1,7 m tới dãy kệ); bàn nước tròn trước giữa sofa; 6 chỗ ngồi + người đứng máy quay.
- Lounge Bar kê đối xứng: quầy bar tròn bán kính 2 m ở giữa (cửa ra vào quầy bên hông phía đông có tấm lật), tháp kệ rượu và
  khung mái vòng neon (thoáng, không che quầy khi nhìn từ trên), 11 ghế bar quanh quầy; 4 booth ghế da đối xứng hai vách; cây lớn
  hai góc bắc. Người pha chế cố định (`scene/Staff.tsx`, không thuộc roster Agent): sơ mi trắng, gi-lê nâu, cà vạt đen.
- Nội thất: bàn có nẹp cạnh, chân khung kim loại chữ U (bàn Giám đốc hai hộc tủ, mặt da); màn hình viền mỏng; thảm da kê bàn,
  chuột, cốc; ghế công thái học (lưng lưới, tựa đầu, tay vịn), ghế da có đường chần; ghế Creative dáng thiết kế chân gỗ xiên;
  sofa có gối tựa; phòng Giám đốc có kệ sách gỗ óc chó và bàn trà mặt kính (Kenney chỉ còn cây lớn).

## Điều chỉnh 2026-11-18 (5): quầy bar lớn, phòng Giám đốc, khu phông xanh
- Quầy bar tròn bán kính 2,6 m (mặt quầy sâu 0,8 m, bậc pha chế thấp phía trong), 15 ghế bar; bỏ mái và đèn trần, tháp kệ rượu
  chỉ còn vòng neon trên đỉnh. Người pha chế đứng phía nam trong quầy để không bị tháp che.
- Video Studio: bàn nước tròn đường kính 1,8 m, cách lòng sofa ≈ 1 m để đi lại. Khu phông xanh: giàn khung nhôm có 3 đèn spot và
  dải LED, cụm bục sản phẩm ba tầng, 2 đèn LED bảng, tấm hắt sáng, màn hình theo dõi cạnh máy quay, vạch đánh dấu trên sàn.
- Director Office: TV lớn trên tủ kệ thấp thay kệ sách; bàn chữ U rộng 3 m (hai cánh về sau lưng, lối vào giữa); bộ sofa giữa
  phòng gồm hai sofa quay vào nhau và bàn trà, chừa lối hai bên từ cửa tới bàn; bỏ ghế khách.

## Điều chỉnh 2026-11-18 (6): nhân viên không nhún nhảy, cửa quầy bar đóng
- `clipFor`: mọi tư thế đứng/ngồi dừng ở khung đầu của clip (không lặp idle/sit/emote/pick-up); chỉ bước đi và thao tác tay ở
  bảng trắng/thiết bị còn chạy clip. Cử động còn lại là lớp chỉnh tay/đầu nhẹ (gõ phím, đọc, nhìn quanh). "Trò chuyện" là
  tư thế tĩnh nhìn quanh; "nhận việc" là cầm tài liệu tĩnh. Người pha chế đứng yên cầm đồ bằng hai tay.
- Cửa quầy bar luôn đóng (không ai ra vào): tấm lật nằm phẳng nối mặt quầy, cánh cửa lửng bên dưới.

## Điều chỉnh 2026-11-18 (7): phân bổ Agent theo D-18

Theo D-18 (xem `docs/product/roadmap.md`), đội mặc định 8 Agent và tối đa 16. D-5/D-6 giữ nguyên: 4 là sức chứa bàn, không phải giới hạn cứng.

- **Mặt bằng: tối đa 4 chỗ làm việc mỗi phòng** (không tính Meeting Room và Lounge), kê đối xứng qua trục giữa phòng:
  - Research: lưới 2×2 (x = −13,4 / −8,6; z = −13,4 / −10,2), lối giữa 2,6 m thẳng cửa nam; Scriptwriting là bản gương (x = 8,6 / 13,4).
  - Creative: lưới 2×2 (vị trí và hướng nhìn: xem Điều chỉnh (8)).
  - General Workspace: bàn Coordinator chữ U và ba bàn general quay ra cửa tây (toạ độ: xem Điều chỉnh (8)).
  - Video Studio: người đứng máy quay (trên trục z = 11) và ba chỗ sofa (j = −2, 0, 2) đối xứng qua trục.
  - Module bàn mở rộng: 2×2 mỗi module (dx = 3 / 7).
  - Director Office: một bàn. Kiểm thử đối xứng nay phủ cả General Workspace và module; chỉ loại trừ Video Studio và Lounge.
- **HUD** chọn 8 / 12 / 16 Agent (mặc định 8); `BENCH_COUNTS` = [8, 12, 16]; đo nặng vẫn dùng `?agents=`.
- **Roster giả lập** (`createRoster`) lấy vai trò theo `STAFFING_ORDER`; từ Agent thứ 16 xoay vòng chuyên môn và ngồi tạm ở General Workspace.

## Điều chỉnh 2026-11-18 (8): bàn quay ra cửa, chỗ ngồi cố định, bàn trưởng phòng

Phản hồi của người dùng: nhân viên chạy qua chạy lại quá nhiều; bàn Creative/General Workspace chưa quay ra cửa; bàn Coordinator cần là bàn trưởng phòng.

- **Bàn quay ra cửa** (người ngồi nhìn về phía cửa phòng; kiểm thử đối xứng nay gương qua trục đi qua cửa: cửa n/s gương theo x, cửa e/w gương theo z):
  - Creative (cửa đông): `facing` = π/2, bốn chỗ ngồi x = −14,4 / −10,4, z = ±2,2; lối giữa 2,8 m thẳng cửa; bảng trắng tường tây và hai beanbag giữ nguyên.
  - General Workspace (cửa tây): `facing` = −π/2, ba bàn general ở x = 11,2, z = −2,9 / 0 / 2,9; bàn trưởng phòng ở cuối phòng (x = 14,8, z = 0). Khe giữa các bàn ≥ 1,3 m; lối vòng sau cánh U vào ghế.
- **Chỗ ngồi cố định** (khớp `docs/product/boundaries.md` mục 2): `STATE_BEHAVIOR` đặt `assigned`, `researching`, `brainstorming`, `writing`, `generating_video`, `publishing`, `analyzing`, `offline` ở `role_home`. `SeatAllocator.register` gán eager bàn cố định theo thứ tự roster: khu nhà của vai trò, khu đầy thì bàn General Workspace kèm `overflowFrom`, hết nữa thì mở module. Bàn cố định không trả về pool; chỉ ghế họp và ghế Lounge được cho mượn. `idle` ra Lounge, Lounge hết chỗ thì ngồi bàn của mình (không mở module); `planning`/`reviewing`/`conversing`/`awaiting_user_reply` ở bàn của Coordinator/Director. Roster 15 vừa tòa nhà chính; từ Agent thứ 16 có bàn ở General Workspace/module (Research đã đủ 4 bàn).
- **Bàn trưởng phòng** (bàn Coordinator): chữ U lớn (mặt chính 2,8 × 1,0 và hai cánh `U_WINGS.coordinator` chạy về sau lưng; cả hai cánh là vật cản trong `plan.ts`), ghế exec bọc da, ba màn hình (trái/giữa/phải nghiêng vào trong), thùng máy và laptop. Bàn Director dùng chung bảng cánh `U_WINGS`.
- Kiểm thử: `walk.test.ts` (hướng nhìn ra cửa, cánh U, đối xứng theo trục cửa), `layout.test.ts`, `sim/seating.test.ts` (FakeEventBus 2000 nhịp, roster 16 và 30: không trùng chỗ, Agent làm việc ở đúng bàn cố định). Hình bàn chữ U/ghế/màn hình chưa kiểm tự động, kiểm bằng mắt trong app.
