CREATE TABLE `provider_status` (
	`provider` text PRIMARY KEY NOT NULL,
	`utilization_5h` real,
	`utilization_7d` real,
	`resets_at` integer,
	`blocked_until` integer,
	`block_reason` text,
	`warned_resets_at` integer,
	`quota_backoff_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
