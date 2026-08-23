DROP INDEX `non_campaign_clips_user_campaign_idx` ON `non_campaign_clips`;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `verified_user_id` varchar(128);--> statement-breakpoint
CREATE INDEX `non_campaign_clips_user_campaign_verified_idx` ON `non_campaign_clips` (`user_id`,`campaign_id`,`verified_user_id`);