CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`goal` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`current_step_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_project_idx` ON `plans` (`project_id`);--> statement-breakpoint
CREATE INDEX `plans_state_idx` ON `plans` (`state`);--> statement-breakpoint
CREATE TABLE `plan_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`parent_step_id` text,
	`order_index` integer NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`evidence` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_steps_plan_idx` ON `plan_steps` (`plan_id`);--> statement-breakpoint
CREATE INDEX `plan_steps_status_idx` ON `plan_steps` (`status`);--> statement-breakpoint
CREATE TABLE `plan_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`reason` text NOT NULL,
	`delta` text DEFAULT '{"added":[],"removed":[]}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_revisions_plan_idx` ON `plan_revisions` (`plan_id`);
