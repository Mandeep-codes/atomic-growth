ALTER TABLE `submissions` ADD `reviewer_assignment_user_id` varchar(255);--> statement-breakpoint
CREATE INDEX `submissions_assignment_idx` ON `submissions` (`reviewer_assignment_user_id`);