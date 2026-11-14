CREATE TABLE `storyboard_notifications` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`workflow_run_id` text(100) NOT NULL,
	`workflow_claim_id` text(100),
	`notification` text NOT NULL,
	`sequence_status` text NOT NULL,
	`delivered_at` integer,
	`last_attempt_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_storyboard_notifications_owner` ON `storyboard_notifications` (`organization_id`,`sequence_id`,`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_storyboard_notifications_pending` ON `storyboard_notifications` (`delivered_at`,`last_attempt_at`,`created_at`,`id`);