CREATE TABLE `influencer_campaigns` (
	`id` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`end_date` timestamp,
	`external_password` varchar(255),
	`demographics_json` json,
	`twitter_total_impressions` int NOT NULL DEFAULT 0,
	`linkedin_total_impressions` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `influencer_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `influencer_linkedin_submission` (
	`id` varchar(128) NOT NULL,
	`influencer_campaign_id` varchar(128),
	`link` text NOT NULL,
	`platform` varchar(255) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`submitted_by` varchar(255) NOT NULL,
	`submitted_at` timestamp NOT NULL DEFAULT (now()),
	`parsed_demographics` json,
	`demographics_screenshot_url` text,
	`impressions` int NOT NULL DEFAULT 0,
	`likes` int NOT NULL DEFAULT 0,
	`comments` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `influencer_linkedin_submission_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `influencer_twitter_submission` (
	`id` varchar(128) NOT NULL,
	`influencer_campaign_id` varchar(128),
	`link` text NOT NULL,
	`platform` varchar(255) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`submitted_by` varchar(255) NOT NULL,
	`submitted_at` timestamp NOT NULL DEFAULT (now()),
	`parsed_demographics` json,
	`demographics_screenshot_url` text,
	`views` int NOT NULL DEFAULT 0,
	`bookmark_count` int NOT NULL DEFAULT 0,
	`reply_count` int NOT NULL DEFAULT 0,
	`quote_count` int NOT NULL DEFAULT 0,
	`favorite_count` int NOT NULL DEFAULT 0,
	`retweet_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `influencer_twitter_submission_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `influencer_linkedin_submission` ADD CONSTRAINT `linkedin_influencer_campaign_fk` FOREIGN KEY (`influencer_campaign_id`) REFERENCES `influencer_campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `influencer_twitter_submission` ADD CONSTRAINT `twitter_influencer_campaign_fk` FOREIGN KEY (`influencer_campaign_id`) REFERENCES `influencer_campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `submissions_influencers_campaign_idx` ON `influencer_linkedin_submission` (`influencer_campaign_id`);--> statement-breakpoint
CREATE INDEX `submissions_influencers_campaign_idx` ON `influencer_twitter_submission` (`influencer_campaign_id`);