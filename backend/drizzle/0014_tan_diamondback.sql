CREATE TABLE `referral_codes_v2` (
	`id` varchar(128) NOT NULL,
	`code` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referral_codes_v2_id` PRIMARY KEY(`id`),
	CONSTRAINT `referral_codes_v2_code_idx` UNIQUE(`code`),
	CONSTRAINT `referral_codes_v2_user_idx` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `referred_users_v2` (
	`id` varchar(128) NOT NULL,
	`referral_code_id` varchar(128),
	`user_id` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referred_users_v2_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `referred_users_v2` ADD CONSTRAINT `referred_users_v2_referral_code_id_referral_codes_v2_id_fk` FOREIGN KEY (`referral_code_id`) REFERENCES `referral_codes_v2`(`id`) ON DELETE no action ON UPDATE no action;