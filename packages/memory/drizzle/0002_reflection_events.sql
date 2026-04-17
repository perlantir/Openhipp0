CREATE TABLE `reflection_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`session_id` text,
	`turn_index` integer NOT NULL,
	`kind` text NOT NULL,
	`rubric_issues` text DEFAULT '[]' NOT NULL,
	`llm_invoked` integer DEFAULT false NOT NULL,
	`critique_score` real,
	`accept` integer,
	`revision_applied` integer DEFAULT false NOT NULL,
	`outcome_score` real,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reflection_events_project_agent_idx` ON `reflection_events` (`project_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `reflection_events_kind_idx` ON `reflection_events` (`kind`);--> statement-breakpoint
CREATE INDEX `reflection_events_session_idx` ON `reflection_events` (`session_id`);
