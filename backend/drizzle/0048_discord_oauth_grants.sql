CREATE TABLE `discord_oauth_grants` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`discord_id` varchar(255) NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`scope` varchar(255),
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `discord_oauth_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `discord_oauth_grants_user_idx` UNIQUE(`user_id`)
);
