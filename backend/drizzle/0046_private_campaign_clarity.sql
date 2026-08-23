ALTER TABLE `campaigns` ADD `payment_methods` json;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_show_min_views` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_teaser_description` text;