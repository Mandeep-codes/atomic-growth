CREATE TABLE `deleted_clip_reserves` (
	`id` varchar(128) NOT NULL,
	`submission_id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`url` text,
	`platform` varchar(50),
	`views` int NOT NULL DEFAULT 0,
	`total_owed` decimal(12,4) NOT NULL,
	`clawed_amount` decimal(12,4) NOT NULL DEFAULT 0,
	`status` varchar(20) NOT NULL DEFAULT 'outstanding',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deleted_clip_reserves_id` PRIMARY KEY(`id`),
	CONSTRAINT `deleted_clip_reserves_submission_idx` UNIQUE(`submission_id`)
);
--> statement-breakpoint
CREATE INDEX `deleted_clip_reserves_user_idx` ON `deleted_clip_reserves` (`user_id`);--> statement-breakpoint
CREATE INDEX `deleted_clip_reserves_status_idx` ON `deleted_clip_reserves` (`status`);