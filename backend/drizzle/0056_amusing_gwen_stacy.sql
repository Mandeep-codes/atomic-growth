-- Weekly demographic cycles.
--
-- drizzle-kit generated `ADD cycle_start date NOT NULL` with no default. Against
-- the existing rows that either fails outright under strict sql_mode or silently
-- writes '0000-00-00'. Rewritten by hand into the safe sequence: add nullable,
-- backfill, THEN enforce NOT NULL, and only swap the unique index once every row
-- holds a real value.
--
-- Backfill maps each legacy row to the Monday (WEEKDAY()=0) of the week it was
-- created, so historical reports land in a plausible cycle. The old index already
-- guaranteed at most one row per (campaign_id, verified_user_id), so adding any
-- third column preserves uniqueness regardless of the value chosen.

ALTER TABLE `demographics_verifications_v2` ADD `cycle_start` date NULL;--> statement-breakpoint
ALTER TABLE `demographics_verifications_v2` ADD `evidence_video_url` text;--> statement-breakpoint
UPDATE `demographics_verifications_v2`
  SET `cycle_start` = DATE(`created_at` - INTERVAL WEEKDAY(`created_at`) DAY)
  WHERE `cycle_start` IS NULL;--> statement-breakpoint
ALTER TABLE `demographics_verifications_v2` MODIFY `cycle_start` date NOT NULL;--> statement-breakpoint
ALTER TABLE `demographics_verifications_v2` DROP INDEX `demographics_verifications_v2_campaign_verified_user_idx`;--> statement-breakpoint
ALTER TABLE `demographics_verifications_v2` ADD CONSTRAINT `demographics_verifications_v2_campaign_verified_user_idx` UNIQUE(`campaign_id`,`verified_user_id`,`cycle_start`);
