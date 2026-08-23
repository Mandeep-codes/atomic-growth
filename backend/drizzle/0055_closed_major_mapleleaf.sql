CREATE TABLE `campaign_geo_rules` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`name` varchar(60),
	`countries` json NOT NULL,
	`match_mode` enum('combined','each') NOT NULL DEFAULT 'each',
	`min_combined_percentage` decimal(5,2) NOT NULL DEFAULT 0,
	`bonus_cpm_per_1000` decimal(8,4) NOT NULL,
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_geo_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- NOTE: drizzle-kit also emitted an unrelated
--   ALTER TABLE `audit_log` MODIFY COLUMN `ts` timestamp(3) ...
-- here, from pre-existing drift between schema.ts and the meta snapshot.
-- Removed deliberately: this migration introduces the geo-rules table and must
-- not carry an unrelated DDL change to an audit table with it. Verified against
-- production on 2026-07-31 — that column is ALREADY timestamp(3), so the
-- statement was a no-op. The drift is unchanged by this file.
ALTER TABLE `campaign_geo_rules` ADD CONSTRAINT `campaign_geo_rules_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `campaign_geo_rules_campaign_idx` ON `campaign_geo_rules` (`campaign_id`);