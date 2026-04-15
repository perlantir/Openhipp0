CREATE TABLE `agent_skills_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`domain` text NOT NULL,
	`success_rate` real DEFAULT 0 NOT NULL,
	`total_tasks` integer DEFAULT 0 NOT NULL,
	`last_updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_skills_profile_agent_domain_idx` ON `agent_skills_profile` (`agent_name`,`domain`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`agent_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_project_idx` ON `audit_log` (`project_id`);--> statement-breakpoint
CREATE INDEX `audit_log_agent_idx` ON `audit_log` (`agent_id`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `decision_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`relationship` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decision_edges_source_idx` ON `decision_edges` (`source_id`);--> statement-breakpoint
CREATE INDEX `decision_edges_target_idx` ON `decision_edges` (`target_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`reasoning` text NOT NULL,
	`made_by` text NOT NULL,
	`affects` text DEFAULT '[]' NOT NULL,
	`confidence` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`embedding` text,
	`superseded_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decisions_project_idx` ON `decisions` (`project_id`);--> statement-breakpoint
CREATE INDEX `decisions_status_idx` ON `decisions` (`status`);--> statement-breakpoint
CREATE INDEX `decisions_made_by_idx` ON `decisions` (`made_by`);--> statement-breakpoint
CREATE TABLE `health_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`component` text NOT NULL,
	`severity` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`action_taken` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `health_events_component_idx` ON `health_events` (`component`);--> statement-breakpoint
CREATE INDEX `health_events_severity_idx` ON `health_events` (`severity`);--> statement-breakpoint
CREATE INDEX `health_events_created_idx` ON `health_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `llm_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`agent_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `llm_usage_project_idx` ON `llm_usage` (`project_id`);--> statement-breakpoint
CREATE INDEX `llm_usage_provider_model_idx` ON `llm_usage` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `llm_usage_created_idx` ON `llm_usage` (`created_at`);--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text,
	`content` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`source_session_id` text,
	`embedding` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_entries_project_agent_idx` ON `memory_entries` (`project_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `memory_entries_user_idx` ON `memory_entries` (`user_id`);--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`result` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outcomes_decision_idx` ON `outcomes` (`decision_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text,
	`summary` text NOT NULL,
	`full_text` text NOT NULL,
	`tool_calls_count` integer DEFAULT 0 NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`lineage_parent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_history_project_agent_idx` ON `session_history` (`project_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `session_history_lineage_idx` ON `session_history` (`lineage_parent_id`);--> statement-breakpoint
CREATE TABLE `skill_improvements` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`previous_version` integer NOT NULL,
	`new_version` integer NOT NULL,
	`diff` text NOT NULL,
	`reason` text NOT NULL,
	`triggered_by` text NOT NULL,
	`improved_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_improvements_skill_idx` ON `skill_improvements` (`skill_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`content_md` text NOT NULL,
	`trigger_pattern` text,
	`times_used` integer DEFAULT 0 NOT NULL,
	`times_improved` integer DEFAULT 0 NOT NULL,
	`success_rate` real DEFAULT 0 NOT NULL,
	`auto_generated` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`parent_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skills_project_agent_idx` ON `skills` (`project_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `skills_parent_idx` ON `skills` (`parent_version_id`);--> statement-breakpoint
CREATE TABLE `user_models` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`communication_style` text,
	`expertise_domains` text DEFAULT '[]' NOT NULL,
	`workflow_preferences` text DEFAULT '{}' NOT NULL,
	`active_projects` text DEFAULT '[]' NOT NULL,
	`tool_preferences` text DEFAULT '{}' NOT NULL,
	`risk_tolerance` text DEFAULT 'medium' NOT NULL,
	`interaction_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_models_user_project_idx` ON `user_models` (`user_id`,`project_id`);