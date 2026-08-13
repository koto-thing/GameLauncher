CREATE TABLE `approval_decisions` (
	`request_id` text NOT NULL,
	`approver_github_user_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`decided_at` text NOT NULL,
	PRIMARY KEY(`request_id`, `approver_github_user_id`)
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`intake_object_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_count` integer NOT NULL,
	`claimed_sha256` text NOT NULL,
	`status` text NOT NULL,
	`sealed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_intake_object_key_unique` ON `artifacts` (`intake_object_key`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_github_user_id` text,
	`actor_login_snapshot` text,
	`occurred_at` text NOT NULL,
	`payload_json` text NOT NULL,
	`previous_event_hash` text NOT NULL,
	`event_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audit_events_request_sequence` ON `audit_events` (`request_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_occurred` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `deployment_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_sha256` text NOT NULL,
	`game_id` text NOT NULL,
	`version` text NOT NULL,
	`metadata_json` text NOT NULL,
	`metadata_sha256` text NOT NULL,
	`requester_github_user_id` text NOT NULL,
	`source_staging_request_id` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`submitted_at` text,
	`production_eligible_until` text
);
--> statement-breakpoint
CREATE INDEX `idx_deployment_requests_created` ON `deployment_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deployment_requests_state` ON `deployment_requests` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deployment_requests_environment_game_version` ON `deployment_requests` (`environment`,`game_id`,`version`);--> statement-breakpoint
CREATE TABLE `policy_grants` (
	`github_user_id` text NOT NULL,
	`grant_type` text NOT NULL,
	`granted_by_github_user_id` text NOT NULL,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`github_user_id`, `grant_type`)
);
--> statement-breakpoint
CREATE INDEX `idx_policy_grants_active` ON `policy_grants` (`grant_type`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `request_approvers` (
	`request_id` text NOT NULL,
	`approver_github_user_id` text NOT NULL,
	`designated_by_github_user_id` text NOT NULL,
	`designated_at` text NOT NULL,
	PRIMARY KEY(`request_id`, `approver_github_user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`github_user_id` text PRIMARY KEY NOT NULL,
	`login_snapshot` text NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`last_verified_at` text NOT NULL
);
