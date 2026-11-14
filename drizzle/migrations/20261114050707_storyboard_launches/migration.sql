CREATE TABLE `storyboard_launches` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`workflow_run_id` text(100) NOT NULL,
	`prepared` text NOT NULL,
	`submitted_at` integer,
	`last_attempt_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_storyboard_launches_run` ON `storyboard_launches` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_storyboard_launches_pending` ON `storyboard_launches` (`submitted_at`,`last_attempt_at`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_storyboard_launches_sequence` ON `storyboard_launches` (`organization_id`,`sequence_id`);