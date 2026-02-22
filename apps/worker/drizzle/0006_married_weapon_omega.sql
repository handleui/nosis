PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`office_id` text NOT NULL,
	`repo_url` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`default_branch` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`office_id`) REFERENCES `offices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "user_id", "office_id", "repo_url", "owner", "repo", "default_branch", "created_at", "updated_at") SELECT "id", "user_id", "office_id", "repo_url", "owner", "repo", "default_branch", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_projects_user_created` ON `projects` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_projects_user_office_created` ON `projects` (`user_id`,`office_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_user_office_repo_url` ON `projects` (`user_id`,`office_id`,`repo_url`);