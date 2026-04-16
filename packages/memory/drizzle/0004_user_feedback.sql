CREATE TABLE `user_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`turn_id` text,
	`skill_id` text,
	`rating` integer NOT NULL,
	`reason` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_feedback_project_idx` ON `user_feedback` (`project_id`);--> statement-breakpoint
CREATE INDEX `user_feedback_skill_idx` ON `user_feedback` (`skill_id`);--> statement-breakpoint
CREATE INDEX `user_feedback_user_idx` ON `user_feedback` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_feedback_session_idx` ON `user_feedback` (`session_id`);
