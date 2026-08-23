ALTER TABLE `non_campaign_clips` ADD `status` enum('pending','approved','rejected') DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `rejected_reason` varchar(1024);--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `reviewed_by` varchar(255);--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `reviewer_assignment_user_id` varchar(255);--> statement-breakpoint
ALTER TABLE `non_campaign_clips` ADD `reviewed_at` timestamp;--> statement-breakpoint
CREATE INDEX `non_campaign_clips_campaign_status_idx` ON `non_campaign_clips` (`campaign_id`,`status`);