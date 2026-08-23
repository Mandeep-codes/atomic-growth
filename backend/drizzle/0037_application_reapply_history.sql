ALTER TABLE `campaign_applications` ADD `apply_count` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_applications` ADD `last_rejected_reason` text;--> statement-breakpoint
ALTER TABLE `campaign_applications` ADD `last_rejected_at` timestamp;