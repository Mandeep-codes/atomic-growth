CREATE TABLE `campaign_activity_graces` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`inactive_week_start` timestamp,
	`inactive_week_end` timestamp,
	`expires_at` timestamp NOT NULL,
	`granted_by` varchar(255) NOT NULL,
	`note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_activity_graces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_application_accounts` (
	`id` varchar(128) NOT NULL,
	`application_id` varchar(128) NOT NULL,
	`verified_user_id` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_application_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_application_accounts_app_account_idx` UNIQUE(`application_id`,`verified_user_id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_applications` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`reviewed_by` varchar(255),
	`reviewed_at` timestamp,
	`rejected_reason` text,
	`discord_join_method` varchar(20),
	`discord_invite_url` text,
	`discord_joined_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_applications_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_applications_campaign_user_idx` UNIQUE(`campaign_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `visibility` varchar(20) DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_show_budget` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_show_rates` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_show_description` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_teaser_title` varchar(255);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_teaser_image_url` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_discord_guild_id` varchar(50);--> statement-breakpoint
CREATE INDEX `campaign_activity_graces_campaign_user_idx` ON `campaign_activity_graces` (`campaign_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `campaign_activity_graces_expires_idx` ON `campaign_activity_graces` (`expires_at`);--> statement-breakpoint
CREATE INDEX `campaign_application_accounts_app_idx` ON `campaign_application_accounts` (`application_id`);--> statement-breakpoint
CREATE INDEX `campaign_applications_campaign_status_idx` ON `campaign_applications` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_applications_user_idx` ON `campaign_applications` (`user_id`);