CREATE TABLE `intake_upload_parts` (
	`artifact_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `part_number`)
);
--> statement-breakpoint
CREATE TABLE `intake_uploads` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`intake_object_key` text NOT NULL,
	`multipart_upload_id` text NOT NULL,
	`requester_github_user_id` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_count` integer NOT NULL,
	`claimed_sha256` text NOT NULL,
	`game_id` text NOT NULL,
	`version` text NOT NULL,
	`part_size` integer NOT NULL,
	`part_count` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_uploads_intake_object_key_unique` ON `intake_uploads` (`intake_object_key`);--> statement-breakpoint
CREATE INDEX `idx_intake_uploads_requester_state` ON `intake_uploads` (`requester_github_user_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_intake_uploads_expires` ON `intake_uploads` (`expires_at`);