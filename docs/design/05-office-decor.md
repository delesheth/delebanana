# Quy tắc thiết kế nội thất văn phòng 3D

> Áp dụng cho **mọi** thay đổi đồ đạc, trang trí, bố trí phòng trong văn phòng 3D (`apps/web/src/office/plan.ts`,
> `apps/web/src/scene/Furniture.tsx`, `apps/web/src/scene/palette.ts`). Chủ dự án rất coi trọng sự cân đối: một món lệch
> là lỗi, không phải chi tiết nhỏ. Cập nhật: 2026-11-23.

## 1. Cân đối là bắt buộc

- **Mỗi phòng có một trục đối xứng** = đường qua tâm cửa phòng, vuông góc với tường có cửa
  (Research x = -11, Scriptwriting x = 11, Creative z = 0).
- **Món đặt trên trục** (bàn chính, thảm, tủ sách giữa, sofa giữa, bục DJ…) phải căn đúng giữa trục.
- **Món lệch trục phải đi theo cặp**: bản bên kia cùng loại, cùng màu, cùng kích thước, vị trí và hướng soi gương
  (ví dụ hai tượng hai góc, hai đèn cây hai bên bàn, hai loa hai bên bục DJ, hai ghế lười hai góc cửa).
- **Hoạ tiết** trong một món (sách trên kệ, mảng graffiti…) cũng dựng một nửa rồi soi gương sang nửa kia.
- Không thêm món "cho vui" một bên. Thiếu chỗ cho bản đối xứng thì bỏ cả cặp.
- Kiểm tra tự động: `apps/web/src/office/symmetry.test.ts` soi gương mọi đồ đạc và vật cản trong các phòng riêng.
  Thêm phòng riêng mới thì thêm phòng đó vào test.

## 2. Không đè lên kiến trúc

- **Bảng tên phòng** hàng bắc treo ở y ≈ 2,55 m (mép dưới ≈ 2,36 m): đồ trên tường bắc phải có đỉnh ≤ 2,25 m và không
  che bảng tên.
- **Cửa sổ** tường ngoài (tường bắc ở x = ±2,8, ±7,4, ±14,6; tường tây và đông ở z = -11), mỗi cửa rộng 1,5 m (khung
  1,62 m): không treo hoặc kê đồ che cửa sổ. Món "từ cửa sổ tới góc" phải dừng đúng mép khung cửa sổ.
- **Chỉ tường ngoài (cao 3 m) mới treo được đồ.** Vách giữa các phòng là kính thấp: đồ sát vách phải là đồ đứng sàn
  có chân hoặc đế, không được lơ lửng.
- **Cửa phòng** rộng 2 m: luôn chừa lối thẳng từ cửa vào tới ghế làm việc; đồ trên trục cửa phải để lối đi hai bên.

## 3. Màu và chất liệu

- **Mỗi phòng một màu sàn riêng** (`ROOM_FLOORS` trong `palette.ts`), hợp cá tính phòng, giống cách làm với phòng Giám
  đốc và Lounge.
- **Bàn và thảm phải tương phản** với nhau và với sàn (bàn không được "chìm" vào thảm).
- **Bàn làm việc phòng riêng là bàn xịn**: chân hộp liền khối hoặc hộc tủ, mặt dày có viền. Không dùng bàn 4 chân mảnh.
- **Ghế phòng riêng là ghế lớn**: ghế da cao hoặc ghế gaming, cùng tông màu phòng.

## 4. Duyệt trước khi thêm đồ

- **Mọi món trang trí mới**, đổi phong cách phòng, hoặc đổi màu sàn đều **phải hỏi chủ dự án duyệt trước**, kèm phác
  thảo bố trí (sơ đồ ASCII nhìn từ trên xuống, ghi rõ trục đối xứng). Không tự ý thêm.
- **Không đổi chức năng phòng** khi chưa được yêu cầu. Ví dụ: Video Production Studio là phòng quay, chỗ làm việc
  của Video Producer là đứng sau máy quay; không biến nó thành phòng theo phong cách cá nhân.
- **Chụp ảnh kiểm tra** từng phòng đã sửa (nút phòng trên Dock) trước khi báo xong.

## 5. Hiện trạng đã duyệt

Nhân viên: không ai đội mũ (Bình hiphop chỉ có polo vàng + dây chuyền vàng). Khi trưởng phòng chia việc (`planning`) hoặc
duyệt bài (`reviewing`), trưởng phòng và cả đội (trừ Giám đốc) vào Meeting Room ngồi quanh bàn.


| Phòng | Trục | Đồ đạc |
|---|---|---|
| Research (An, học giả) | x = -11 | Sàn óc chó tối; thảm xanh rêu; bàn óc chó có đèn banker, ghế da; hai kệ tạp chí hai bên bàn; tủ sách lớn giữa hai cửa sổ; hai tượng bán thân **màu đồng** trên bệ ở hai góc trên (bệ từ mép cửa sổ tới góc); hai tủ kính trưng bày ở hai góc dưới; hai cột đèn đồng hai bên lối vào |
| Scriptwriting (Hà, hồng sang trọng) | x = 11 | Sàn gỗ trắng hồng; thảm tròn hồng; bàn đá trắng chân hộp viền vàng, ghế da lớn màu hồng; tim neon giữa tường bắc (dưới bảng tên); hai đèn cây hồng hai bên bàn; hai bình hoa hai góc trên; rèm voan hồng cho hai cửa sổ; sofa hồng trên trục, quay về bàn |
| Creative (Bình, hiphop) | z = 0 | Sàn bê tông đen; bục DJ giữa tường tây, hai loa hai bên; graffiti thu hẹp làm phông sau bục, vương miện neon trên bục; bàn đen viền LED dịch về phía cửa, trên thảm xanh neon; hai ghế lười tím và hai cột đèn LED ở hai góc cạnh cửa |
| Video Production Studio | — | Giữ nguyên thiết kế phòng quay (phông xanh, máy quay, đèn, sofa vòng cung, kệ sản phẩm). Video Producer đứng sau máy quay |
| General Workspace | — | Bàn chữ U của trưởng phòng TC; hai bàn cho Publisher và Analyst |
