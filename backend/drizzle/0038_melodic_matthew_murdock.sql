CREATE TABLE `campaign_cpm_group_members` (
	`id` varchar(128) NOT NULL,
	`group_id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_cpm_group_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_cpm_group_members_campaign_user_idx` UNIQUE(`campaign_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `campaign_cpm_groups` (
	`id` varchar(128) NOT NULL,
	`campaign_id` varchar(255) NOT NULL,
	`name` varchar(60) NOT NULL,
	`cpm_per_1000` decimal(8,4) NOT NULL,
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_cpm_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `balance_entries` ADD `campaign_id` varchar(255);--> statement-breakpoint
ALTER TABLE `balance_entries` ADD `counts_toward_campaign` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_cpm_group_members` ADD CONSTRAINT `campaign_cpm_group_members_group_id_campaign_cpm_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `campaign_cpm_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campaign_cpm_groups` ADD CONSTRAINT `campaign_cpm_groups_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `campaign_cpm_group_members_group_idx` ON `campaign_cpm_group_members` (`group_id`);--> statement-breakpoint
CREATE INDEX `campaign_cpm_group_members_user_idx` ON `campaign_cpm_group_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `campaign_cpm_groups_campaign_idx` ON `campaign_cpm_groups` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `balance_entries_campaign_idx` ON `balance_entries` (`campaign_id`);