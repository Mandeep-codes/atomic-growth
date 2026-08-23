ALTER TABLE `campaigns` ADD `end_date` timestamp;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `unavailable_strikes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `unavailable_since` timestamp;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `deleted_clawed_back` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `unavailable_strikes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `unavailable_since` timestamp;--> statement-breakpoint
ALTER TABLE `submissions` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `submissions` ADD `deleted_clawed_back` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `verified_users` ADD `platform_account_id` varchar(255);--> statement-breakpoint
ALTER TABLE `verified_users` ADD `platform_account_secondary_id` varchar(512);--> statement-breakpoint
ALTER TABLE `verified_users` ADD `platform_account_id_resolved_at` timestamp;--> statement-breakpoint
ALTER TABLE `verified_users` ADD `account_unavailable_strikes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `verified_users` ADD `account_deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `verified_users` ADD `account_last_checked_at` timestamp;--> statement-breakpoint
CREATE INDEX `verified_users_platform_account_id_idx` ON `verified_users` (`platform`,`platform_account_id`);