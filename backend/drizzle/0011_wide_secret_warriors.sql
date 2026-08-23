CREATE TABLE `banned_social_media_users` (
	`id` varchar(128) NOT NULL,
	`platform` varchar(255) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`reason` text,
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `banned_social_media_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `banned_social_media_users_platform_handle_idx` UNIQUE(`platform`,`handle`)
);
--> statement-breakpoint
CREATE TABLE `banned_users` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`reason` text,
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `banned_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `banned_users_user_id_idx` UNIQUE(`user_id`)
);
