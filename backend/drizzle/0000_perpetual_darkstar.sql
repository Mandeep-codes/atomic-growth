CREATE TABLE `balance_entries` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`amount` decimal(12,4) NOT NULL DEFAULT 0,
	`currency` varchar(255) DEFAULT 'USD',
	`type` enum('reward','manual_adjustment','withdrawal','withdrawal_refund') NOT NULL,
	`source_type` varchar(255),
	`source_id` varchar(128),
	`memo` text,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `balance_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `balances` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`balance` decimal(12,4) NOT NULL DEFAULT 0,
	`totalEarned` decimal(12,4) NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `balances_user_id_idx` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`bank_name` varchar(255),
	`account_number` varchar(50),
	`ifsc_code` varchar(20),
	`account_holder` varchar(255),
	`branch_name` varchar(255),
	`name` varchar(255),
	`recipient_email` varchar(255),
	`receiver_type` varchar(255),
	`amount_currency` varchar(255),
	`source_currency` varchar(255),
	`target_currency` varchar(255),
	`address_country_code` varchar(10),
	`address_city` varchar(255),
	`address_first_line` varchar(255),
	`address_post_code` varchar(20),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_view_rewards` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`platform` varchar(255) NOT NULL,
	`cpm` float NOT NULL DEFAULT 0,
	`amount` decimal(12,4) NOT NULL DEFAULT 0,
	`view_count` int NOT NULL DEFAULT 0,
	`view_delta` int NOT NULL DEFAULT 0,
	`idempotency_key` varchar(255) NOT NULL,
	`balance_entry_id` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_view_rewards_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_view_rewards_idempotency_key_idx` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `campaign_categories` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`guild_id` varchar(255) NOT NULL,
	`category` varchar(255) NOT NULL,
	`platform` varchar(255) NOT NULL,
	`rate_per_1000` decimal(10,2) NOT NULL,
	`budget` float NOT NULL DEFAULT 0,
	`category_specific_max_payout` float NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` varchar(128) NOT NULL,
	`guild_id` varchar(50) NOT NULL,
	`title` varchar(255),
	`clips` text,
	`budget` int NOT NULL DEFAULT 0,
	`external_budget` int NOT NULL DEFAULT 0,
	`external_password` varchar(255),
	`allowed_verification_methods` json NOT NULL DEFAULT ('["OTP","login-flow","manual"]'),
	`cpm` float NOT NULL DEFAULT 0,
	`image_url` text,
	`description` text,
	`sop_embed_url` text,
	`max_payout` float,
	`min_payout` float NOT NULL DEFAULT 0,
	`views` int DEFAULT 0,
	`active` boolean DEFAULT true,
	`channel_id` varchar(50) NOT NULL,
	`sheet_id` varchar(255),
	`achieved` float DEFAULT 0,
	`ended` boolean DEFAULT false,
	`excel_link` text,
	`demographics_json` json,
	`insta_per_1000` float NOT NULL DEFAULT 0,
	`x_per_1000` float NOT NULL DEFAULT 0,
	`youtube_per_1000` float NOT NULL DEFAULT 0,
	`tiktok_per_1000` float NOT NULL DEFAULT 0,
	`referal-percentage` float NOT NULL DEFAULT 5,
	`max-referal-bonus` float NOT NULL DEFAULT 50,
	`platforms` varchar(255),
	`verify_demography` varchar(255) DEFAULT 'No',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `demographics_verifications_v2` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`verified_user_id` varchar(255) NOT NULL,
	`views_from_submissions_snapshot` int NOT NULL,
	`parsed_data` json,
	`file_url` text,
	`status` enum('created','pending','approved','user-approved','mod-approved','needs-human-review','rejected','cancelled') NOT NULL DEFAULT 'created',
	`approval_method` enum('user','mod','api'),
	`exemption_reason` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `demographics_verifications_v2_id` PRIMARY KEY(`id`),
	CONSTRAINT `demographics_verifications_v2_campaign_verified_user_idx` UNIQUE(`campaign_id`,`verified_user_id`)
);
--> statement-breakpoint
CREATE TABLE `demographics_verifications` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`account_name` varchar(255) NOT NULL,
	`file_type` varchar(50),
	`country` varchar(100) NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `demographics_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guild_settings` (
	`id` varchar(128) NOT NULL,
	`guild_id` varchar(50) NOT NULL,
	`channel_enum` enum('welcome_channel_id','leaderboard_channel_id','live_stats_channel_id','your_account_channel_id','user_commands_channel_id','demographics_verification_channel_id','admin_commands_channel_id','admin_role_id','staff_role_id','verified_role_id','campaign_staff_review_channel_id','clip_submissions_channel_id','user_registrations_channel_id','past_campaigns_channel_id','demographics_staff_review_channel_id') NOT NULL,
	`channel_id` varchar(50) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guild_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `guild_settings_channel_id_unique` UNIQUE(`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` varchar(128) NOT NULL,
	`code` varchar(50) NOT NULL,
	`guild_id` varchar(50) NOT NULL,
	`discord_id` varchar(50) DEFAULT 'Unknown',
	`uses` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invites_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255),
	`views` int,
	`payout` float,
	`upi_id` varchar(255),
	`reference_id` varchar(255),
	`paid` boolean DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`metadata` json,
	`expires_minutes` int,
	`dismissed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referals` (
	`id` varchar(128) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`guild_id` varchar(50) NOT NULL,
	`campaign_id` varchar(50) NOT NULL,
	`discord_id` varchar(50) NOT NULL,
	`referrer_id` varchar(50) NOT NULL,
	`code` varchar(50) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refered_users` (
	`id` varchar(128) NOT NULL,
	`guild_id` varchar(50) NOT NULL,
	`discord_id` varchar(50) NOT NULL,
	`referal_id` varchar(128),
	`referalCompleted` boolean DEFAULT false,
	`reward` float NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refered_users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(128) NOT NULL,
	`name` varchar(64) NOT NULL,
	`description` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_idx` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`discord_id` varchar(50) NOT NULL,
	`role` enum('admin','staff') NOT NULL,
	`added_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_discord_id` PRIMARY KEY(`discord_id`)
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`verified_user_id` varchar(255),
	`reviewed_by` varchar(255) DEFAULT 'unknown',
	`campaign_id` varchar(255) NOT NULL,
	`url` text NOT NULL,
	`category` text,
	`platform` varchar(50) NOT NULL,
	`country` varchar(100),
	`status` varchar(20),
	`views` int NOT NULL DEFAULT 0,
	`message_id` varchar(255),
	`reward` float NOT NULL DEFAULT 0,
	`rejected_reason` text,
	`active` boolean DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_clerk` (
	`id` varchar(128) NOT NULL,
	`clerk_user_id` varchar(255) NOT NULL,
	`discord_id` varchar(255) NOT NULL,
	`discord_username` varchar(255),
	`email` varchar(255),
	`first_name` varchar(255),
	`last_name` varchar(255),
	`image_url` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_clerk_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_clerk_clerk_user_id_unique` UNIQUE(`clerk_user_id`),
	CONSTRAINT `user_clerk_discord_id_unique` UNIQUE(`discord_id`),
	CONSTRAINT `user_clerk_clerk_id_idx` UNIQUE(`clerk_user_id`),
	CONSTRAINT `user_clerk_discord_id_idx` UNIQUE(`discord_id`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`role_id` varchar(128) NOT NULL,
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_roles_user_role_idx` UNIQUE(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `verified_login_credentials` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`email` varchar(255),
	`password` varchar(255),
	`platform` varchar(255) NOT NULL,
	`handle` varchar(100) NOT NULL,
	`forwarding_email` varchar(255),
	`login_creds_manually_verified_at` timestamp,
	`verification_method` enum('login-flow','manual') NOT NULL DEFAULT 'login-flow',
	`verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verified_login_credentials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verified_users` (
	`id` varchar(128) NOT NULL,
	`discord_id` varchar(50) NOT NULL,
	`guild_id` varchar(50) NOT NULL,
	`username` varchar(100) NOT NULL,
	`platform` varchar(255) NOT NULL,
	`handle` varchar(100) NOT NULL,
	`verify_code` varchar(20) NOT NULL,
	`verified` boolean DEFAULT false,
	`verified_login_credentials_id` varchar(128),
	`deleted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verified_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `verified_users_guild_discord_platform_idx` UNIQUE(`guild_id`,`discord_id`,`platform`,`handle`)
);
--> statement-breakpoint
CREATE TABLE `wise_recipient` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`recipient_id` varchar(255) NOT NULL,
	CONSTRAINT `wise_recipient_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wise_withdrawals` (
	`id` varchar(128) NOT NULL,
	`external_recipient_id` varchar(255) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`external_transfer_id` int,
	`external_quote_id` varchar(255),
	`external_status` varchar(255),
	`external_batch_id` varchar(255),
	`user_id` varchar(255) NOT NULL,
	`balance_entry_id` varchar(128) NOT NULL,
	`amount` decimal(12,4) NOT NULL DEFAULT 0,
	`currency` varchar(255) DEFAULT 'USD',
	`status` enum('requested','pending','failed','completed','cancelled') NOT NULL DEFAULT 'requested',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wise_withdrawals_id` PRIMARY KEY(`id`),
	CONSTRAINT `wise_withdrawals_external_id_unique` UNIQUE(`external_id`)
);
--> statement-breakpoint
ALTER TABLE `referals` ADD CONSTRAINT `referals_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referals` ADD CONSTRAINT `referals_referrer_id_verified_users_id_fk` FOREIGN KEY (`referrer_id`) REFERENCES `verified_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refered_users` ADD CONSTRAINT `refered_users_referal_id_referals_id_fk` FOREIGN KEY (`referal_id`) REFERENCES `referals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `balance_entries_user_id_idx` ON `balance_entries` (`user_id`);--> statement-breakpoint
CREATE INDEX `balance_entries_user_source_type_idx` ON `balance_entries` (`user_id`,`source_type`);--> statement-breakpoint
CREATE INDEX `bank_accounts_user_id_idx` ON `bank_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `campaign_view_rewards_user_campaign_idx` ON `campaign_view_rewards` (`user_id`,`campaign_id`);--> statement-breakpoint
CREATE INDEX `campaigncategories_campaign_platform_idx` ON `campaign_categories` (`campaign_id`,`platform`);--> statement-breakpoint
CREATE INDEX `campaigncategories_guild_active_idx` ON `campaign_categories` (`guild_id`);--> statement-breakpoint
CREATE INDEX `campaigns_guild_active_idx` ON `campaigns` (`guild_id`,`active`);--> statement-breakpoint
CREATE INDEX `campaigns_ended_idx` ON `campaigns` (`ended`);--> statement-breakpoint
CREATE INDEX `campaigns_channel_id_idx` ON `campaigns` (`channel_id`);--> statement-breakpoint
CREATE INDEX `demographics_verifications_v2_user_idx` ON `demographics_verifications_v2` (`user_id`);--> statement-breakpoint
CREATE INDEX `demographics_user_status_idx` ON `demographics_verifications` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_user_paid_idx` ON `invoices` (`user_id`,`paid`);--> statement-breakpoint
CREATE INDEX `invoices_reference_id_idx` ON `invoices` (`reference_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `submissions_user_campaign_idx` ON `submissions` (`user_id`,`campaign_id`);--> statement-breakpoint
CREATE INDEX `submissions_campaign_status_active_idx` ON `submissions` (`campaign_id`,`status`,`active`);--> statement-breakpoint
CREATE INDEX `submissions_message_id_idx` ON `submissions` (`message_id`);--> statement-breakpoint
CREATE INDEX `user_roles_user_idx` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `vlc_email_idx` ON `verified_login_credentials` (`email`);--> statement-breakpoint
CREATE INDEX `verified_login_credentials_platform_handle_idx` ON `verified_login_credentials` (`platform`,`user_id`,`email`);--> statement-breakpoint
CREATE INDEX `verified_users_discord_platform_idx` ON `verified_users` (`discord_id`,`platform`);--> statement-breakpoint
CREATE INDEX `wise_recipient_user_id_idx` ON `wise_recipient` (`user_id`);--> statement-breakpoint
CREATE INDEX `wise_recipient_recipient_id_idx` ON `wise_recipient` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `wise_withdrawals_user_id_idx` ON `wise_withdrawals` (`user_id`);--> statement-breakpoint
CREATE INDEX `wise_withdrawals_balance_entry_id_idx` ON `wise_withdrawals` (`balance_entry_id`);--> statement-breakpoint
CREATE INDEX `wise_withdrawals_external_id_idx` ON `wise_withdrawals` (`external_id`);