ALTER TABLE `memory_entries` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `trust` text;--> statement-breakpoint
CREATE INDEX `memory_entries_trust_idx` ON `memory_entries` (`trust`);--> statement-breakpoint
ALTER TABLE `session_history` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `session_history` ADD `trust` text;--> statement-breakpoint
CREATE INDEX `session_history_trust_idx` ON `session_history` (`trust`);