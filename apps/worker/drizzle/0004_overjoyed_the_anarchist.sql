DROP INDEX `idx_projects_user_repo_url`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_user_office_repo_url` ON `projects` (`user_id`,`office_id`,`repo_url`);