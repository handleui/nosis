PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'New Conversation' NOT NULL,
	`letta_agent_id` text,
	`execution_target` text DEFAULT 'sandbox' NOT NULL,
	`office_id` text NOT NULL,
	`workspace_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`office_id`) REFERENCES `offices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "user_id", "title", "letta_agent_id", "execution_target", "office_id", "workspace_id", "created_at", "updated_at") SELECT "id", "user_id", "title", "letta_agent_id", "execution_target", "office_id", "workspace_id", "created_at", "updated_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_conversations_user_updated` ON `conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_user_target_updated` ON `conversations` (`user_id`,`execution_target`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_user_office_updated` ON `conversations` (`user_id`,`office_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_workspace_updated` ON `conversations` (`user_id`,`workspace_id`,`updated_at`);