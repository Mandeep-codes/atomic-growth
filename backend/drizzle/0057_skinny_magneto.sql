ALTER TABLE `campaign_view_rewards` ADD `verified_user_id` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_view_rewards` ADD `geo_bonus_cpm` float DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Two columns only. All four of (user_id, campaign_id, platform,
-- verified_user_id) are varchar(255); under utf8mb4 that index is 4080 bytes,
-- past MySQL's 3072-byte limit, and CREATE INDEX fails with errno 1071.
-- Verified by hitting exactly that error locally before this was corrected.
CREATE INDEX `campaign_view_rewards_account_idx` ON `campaign_view_rewards` (`campaign_id`,`verified_user_id`);