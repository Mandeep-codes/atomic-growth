CREATE TABLE `snapshot_nc_count` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`clip_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `snapshot_nc_count_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `snapshot_nc_views` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`views` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `snapshot_nc_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `snapshot_nc_count_campaign_idx` ON `snapshot_nc_count` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `snapshot_nc_views_campaign_idx` ON `snapshot_nc_views` (`campaign_id`);