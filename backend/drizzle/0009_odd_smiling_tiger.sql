CREATE TABLE `notification_announcements` (
	`id` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`metadata` json,
	`expires_minutes` int,
	`dismissed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `snapshot_submission_count` DROP FOREIGN KEY `snapshot_submission_count_campaign_id_campaigns_id_fk`;
--> statement-breakpoint
ALTER TABLE `snapshot_submission_views` DROP FOREIGN KEY `snapshot_submission_views_campaign_id_campaigns_id_fk`;
