CREATE TABLE `snapshot_submission_count` (
  `id` varchar(128) NOT NULL,
  `campaign_id` varchar(255) NOT NULL,
  `submission_count` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `snapshot_submission_count_id` PRIMARY KEY(`id`),
  CONSTRAINT `snapshot_submission_count_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`)
);
--> statement-breakpoint
CREATE TABLE `snapshot_submission_views` (
  `id` varchar(128) NOT NULL,
  `campaign_id` varchar(255) NOT NULL,
  `views` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `snapshot_submission_views_id` PRIMARY KEY(`id`),
  CONSTRAINT `snapshot_submission_views_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`)
);
--> statement-breakpoint
CREATE INDEX `snapshot_submission_count_campaign_idx` ON `snapshot_submission_count` (`campaign_id`);
--> statement-breakpoint
CREATE INDEX `snapshot_submission_views_campaign_idx` ON `snapshot_submission_views` (`campaign_id`);
