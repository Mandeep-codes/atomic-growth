ALTER TABLE `submissions` ADD `view_delta_zero_attempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `view_delta_skip_count` int DEFAULT 0 NOT NULL;