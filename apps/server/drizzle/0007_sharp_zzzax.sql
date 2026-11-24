CREATE TABLE `platform_apps` (
	`platform` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`app_secret` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`approval_id` text,
	`video_version_id` text NOT NULL,
	`social_account_id` text,
	`platform` text NOT NULL,
	`mode` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`caption_artifact_id` text,
	`status` text NOT NULL,
	`scheduled_at` integer,
	`retries` integer DEFAULT 0 NOT NULL,
	`platform_post_id` text,
	`permalink` text,
	`error` text,
	`api_called_at` integer,
	`published_at` integer,
	`reminded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_campaign` ON `posts` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `posts_status` ON `posts` (`status`);--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`token_expires_at` integer,
	`data_access_expires_at` integer,
	`scopes` text DEFAULT '[]' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `social_accounts_workspace` ON `social_accounts` (`workspace_id`,`platform`);--> statement-breakpoint
CREATE TABLE `social_credentials` (
	`account_id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
