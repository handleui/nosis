CREATE TABLE `conversation_agents` (
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`letta_agent_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`conversation_id`, `role`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
