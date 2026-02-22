CREATE TABLE `offices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_offices_user_updated` ON `offices` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_offices_user_slug` ON `offices` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`office_id` text,
	`repo_url` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`default_branch` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`office_id`) REFERENCES `offices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_projects_user_created` ON `projects` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_projects_user_office_created` ON `projects` (`user_id`,`office_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_user_repo_url` ON `projects` (`user_id`,`repo_url`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_branch` text NOT NULL,
	`working_branch` text NOT NULL,
	`remote_url` text,
	`local_path` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspaces_user_project_updated` ON `workspaces` (`user_id`,`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_project` ON `workspaces` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_api_keys` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `provider`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_api_keys`("user_id", "provider", "encrypted_key", "created_at", "updated_at") SELECT "user_id", "provider", "encrypted_key", "created_at", "updated_at" FROM `user_api_keys`;--> statement-breakpoint
DROP TABLE `user_api_keys`;--> statement-breakpoint
ALTER TABLE `__new_user_api_keys` RENAME TO `user_api_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user`("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt") SELECT "id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt" FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `execution_target` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `office_id` text REFERENCES offices(id);--> statement-breakpoint
ALTER TABLE `conversations` ADD `workspace_id` text REFERENCES workspaces(id);--> statement-breakpoint
CREATE INDEX `idx_conversations_user_target_updated` ON `conversations` (`user_id`,`execution_target`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_user_office_updated` ON `conversations` (`user_id`,`office_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_workspace_updated` ON `conversations` (`user_id`,`workspace_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `scope` text DEFAULT 'global' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_mcp_servers_user_scope` ON `mcp_servers` (`user_id`,`scope`);