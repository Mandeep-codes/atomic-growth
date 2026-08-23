CREATE TABLE `earner_leaderboard_snapshots` (
	`id` varchar(128) NOT NULL,
	`batch_id` varchar(128) NOT NULL,
	`rank` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`username` varchar(255),
	`total_earned` decimal(12,4) NOT NULL,
	`snapshot_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `earner_leaderboard_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `submissions` ADD `hosted_video_url` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `hosted_thumbnail_url` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `hosted_at` timestamp;--> statement-breakpoint
ALTER TABLE `submissions` ADD `hosting_attempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `earner_leaderboard_snapshots_snapshot_at_idx` ON `earner_leaderboard_snapshots` (`snapshot_at`);--> statement-breakpoint
CREATE INDEX `earner_leaderboard_snapshots_batch_idx` ON `earner_leaderboard_snapshots` (`batch_id`);