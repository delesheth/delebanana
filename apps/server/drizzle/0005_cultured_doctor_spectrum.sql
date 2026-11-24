CREATE TABLE `video_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`video_id` text NOT NULL,
	`make_video_approval_id` text NOT NULL,
	`number` integer NOT NULL,
	`provider` text NOT NULL,
	`tool_id` text NOT NULL,
	`status` text NOT NULL,
	`path` text,
	`mime` text,
	`size_bytes` integer,
	`metadata` text,
	`invalid_reasons` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_versions_campaign` ON `video_versions` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `video_versions_video` ON `video_versions` (`video_id`);