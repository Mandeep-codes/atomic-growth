CREATE TABLE `non_campaign_clips` (
	`id` varchar(128) NOT NULL,
	`submission_id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`url` varchar(512) NOT NULL,
	`video_id` varchar(255) NOT NULL,
	`platform` varchar(50) NOT NULL,
	`views` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `non_campaign_clips_id` PRIMARY KEY(`id`),
	CONSTRAINT `non_campaign_clips_platform_video_id_unique` UNIQUE(`platform`,`video_id`)
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `non_campaign_clips_required` int;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD CONSTRAINT `non_campaign_clips_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `non_campaign_clips_submission_idx` ON `non_campaign_clips` (`submission_id`);--> statement-breakpoint
CREATE INDEX `non_campaign_clips_user_idx` ON `non_campaign_clips` (`user_id`);