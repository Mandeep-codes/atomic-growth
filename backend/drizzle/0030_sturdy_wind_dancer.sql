CREATE TABLE `site_settings` (
	`id` varchar(128) NOT NULL,
	`maintenance_mode_enabled` boolean NOT NULL DEFAULT false,
	`maintenance_mode_message` text,
	`maintenance_enabled_at` timestamp,
	`maintenance_enabled_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `card_deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `card_deleted_by` varchar(255);--> statement-breakpoint
CREATE INDEX `campaigns_card_deleted_idx` ON `campaigns` (`card_deleted_at`);