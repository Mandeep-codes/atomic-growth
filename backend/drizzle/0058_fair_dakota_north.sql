DROP INDEX `campaign_view_rewards_account_idx` ON `campaign_view_rewards`;--> statement-breakpoint
ALTER TABLE `balances` ADD `pending_balance` decimal(12,4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_view_rewards` ADD `clearance_state` enum('held','cleared','cancelled') DEFAULT 'cleared' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_view_rewards` ADD `cleared_at` timestamp;--> statement-breakpoint
CREATE INDEX `campaign_view_rewards_account_idx` ON `campaign_view_rewards` (`campaign_id`,`verified_user_id`);