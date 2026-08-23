CREATE TABLE `demographics_reset_requests` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`cycle_start` date NOT NULL,
	`requested_by` varchar(255),
	`note` text,
	`notified_user_count` int NOT NULL DEFAULT 0,
	`closed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `demographics_reset_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `demographics_reset_requests_campaign_open_idx` ON `demographics_reset_requests` (`campaign_id`,`closed_at`);