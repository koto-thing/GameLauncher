CREATE TABLE `execution_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`github_run_id` text,
	`github_run_attempt` integer,
	`workflow_commit_sha` text,
	`stage` text NOT NULL,
	`result` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_execution_attempts_request_number` ON `execution_attempts` (`request_id`,`attempt_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_execution_attempts_github_run` ON `execution_attempts` (`github_run_id`,`github_run_attempt`);