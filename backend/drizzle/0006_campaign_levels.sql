CREATE TABLE `campaign_levels` (
  `id` varchar(128) NOT NULL,
  `campaign_id` varchar(255) NOT NULL,
  `level_threshold` int NOT NULL,
  `cpm_rate` float NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `campaign_levels_id` PRIMARY KEY(`id`),
  CONSTRAINT `campaign_levels_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`)
);
--> statement-breakpoint
CREATE INDEX `campaign_levels_campaign_idx` ON `campaign_levels` (`campaign_id`);
--> statement-breakpoint
CREATE INDEX `campaign_levels_threshold_idx` ON `campaign_levels` (`level_threshold`);
