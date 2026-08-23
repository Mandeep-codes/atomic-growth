CREATE TABLE `campaign_suspensions` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`reason` text,
	`inactive_week_start` timestamp,
	`inactive_week_end` timestamp,
	`suspended_by` varchar(255),
	`unsuspended_at` timestamp,
	`unsuspended_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_suspensions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `non_campaign_clips_per` int DEFAULT 1;--> statement-breakpoint
CREATE INDEX `campaign_suspensions_campaign_idx` ON `campaign_suspensions` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `campaign_suspensions_user_idx` ON `campaign_suspensions` (`user_id`);--> statement-breakpoint
CREATE INDEX `campaign_suspensions_campaign_user_idx` ON `campaign_suspensions` (`campaign_id`,`user_id`);