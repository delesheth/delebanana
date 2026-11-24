-- Đổi tên mặc định của Giám đốc và trưởng phòng (Coordinator) trong dữ liệu đã seed; tên do người dùng đặt thì giữ nguyên.
UPDATE `agents` SET `name` = 'Dele' WHERE `role_template` = 'director' AND `name` = 'Linh';
--> statement-breakpoint
UPDATE `agents` SET `name` = 'TC' WHERE `role_template` = 'coordinator' AND `name` = 'Minh';
