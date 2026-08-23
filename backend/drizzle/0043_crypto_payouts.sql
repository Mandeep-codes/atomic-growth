CREATE TABLE `crypto_payout_batches` (
	`id` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`np_batch_id` varchar(255),
	`status` varchar(32) NOT NULL DEFAULT 'created',
	`created_by` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crypto_payout_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crypto_payout_methods` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`np_currency` varchar(32) NOT NULL,
	`address` varchar(255) NOT NULL,
	`memo` varchar(255),
	`label` varchar(255),
	`whitelist_exported_at` timestamp,
	`whitelisted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crypto_payout_methods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crypto_withdrawals` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`method_id` varchar(128) NOT NULL,
	`np_currency` varchar(32) NOT NULL,
	`address` varchar(255) NOT NULL,
	`memo` varchar(255),
	`amount` decimal(12,4) NOT NULL DEFAULT 0,
	`currency` varchar(255) DEFAULT 'USD',
	`balance_entry_id` varchar(128) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`batch_id` varchar(128),
	`np_payout_id` varchar(255),
	`np_status` varchar(64),
	`status` varchar(20) NOT NULL DEFAULT 'requested',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crypto_withdrawals_id` PRIMARY KEY(`id`),
	CONSTRAINT `crypto_withdrawals_external_id_unique` UNIQUE(`external_id`)
);
--> statement-breakpoint
CREATE INDEX `crypto_payout_batches_np_batch_id_idx` ON `crypto_payout_batches` (`np_batch_id`);--> statement-breakpoint
CREATE INDEX `crypto_payout_methods_user_id_idx` ON `crypto_payout_methods` (`user_id`);--> statement-breakpoint
CREATE INDEX `crypto_payout_methods_address_idx` ON `crypto_payout_methods` (`address`);--> statement-breakpoint
CREATE INDEX `crypto_withdrawals_user_id_idx` ON `crypto_withdrawals` (`user_id`);--> statement-breakpoint
CREATE INDEX `crypto_withdrawals_status_idx` ON `crypto_withdrawals` (`status`);--> statement-breakpoint
CREATE INDEX `crypto_withdrawals_batch_id_idx` ON `crypto_withdrawals` (`batch_id`);--> statement-breakpoint
CREATE INDEX `crypto_withdrawals_external_id_idx` ON `crypto_withdrawals` (`external_id`);