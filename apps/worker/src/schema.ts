import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── Better Auth tables ──

export const user = sqliteTable("user", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey().notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_session_userId").on(table.userId),
    index("idx_session_token").on(table.token),
  ]
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_account_userId").on(table.userId)]
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey().notNull(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});

// ── App tables ──

export const offices = sqliteTable(
  "offices",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
    updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_offices_user_updated").on(table.user_id, table.updated_at),
    uniqueIndex("idx_offices_user_slug").on(table.user_id, table.slug),
  ]
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    office_id: text("office_id")
      .notNull()
      .references(() => offices.id, {
        onDelete: "cascade",
      }),
    repo_url: text("repo_url").notNull(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    default_branch: text("default_branch"),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
    updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_projects_user_created").on(table.user_id, table.created_at),
    index("idx_projects_user_office_created").on(
      table.user_id,
      table.office_id,
      table.created_at
    ),
    uniqueIndex("idx_projects_user_office_repo_url").on(
      table.user_id,
      table.office_id,
      table.repo_url
    ),
  ]
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    project_id: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["cloud"] }).notNull(),
    name: text("name").notNull(),
    base_branch: text("base_branch").notNull(),
    working_branch: text("working_branch").notNull(),
    remote_url: text("remote_url"),
    local_path: text("local_path"),
    status: text("status", { enum: ["ready", "provisioning", "error"] })
      .notNull()
      .default("ready"),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
    updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_workspaces_user_project_updated").on(
      table.user_id,
      table.project_id,
      table.updated_at
    ),
    index("idx_workspaces_project").on(table.project_id),
  ]
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Conversation"),
    letta_agent_id: text("letta_agent_id"),
    execution_target: text("execution_target", {
      enum: ["sandbox"],
    })
      .notNull()
      .default("sandbox"),
    office_id: text("office_id")
      .notNull()
      .references(() => offices.id, {
        onDelete: "cascade",
      }),
    workspace_id: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
    updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    // Covers WHERE user_id = ? ORDER BY updated_at DESC (listConversations)
    index("idx_conversations_user_updated").on(table.user_id, table.updated_at),
    // Covers WHERE user_id = ? AND execution_target = ? ORDER BY updated_at DESC
    index("idx_conversations_user_target_updated").on(
      table.user_id,
      table.execution_target,
      table.updated_at
    ),
    index("idx_conversations_user_office_updated").on(
      table.user_id,
      table.office_id,
      table.updated_at
    ),
    index("idx_conversations_workspace_updated").on(
      table.user_id,
      table.workspace_id,
      table.updated_at
    ),
  ]
);

export const userApiKeys = sqliteTable(
  "user_api_keys",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    encrypted_key: text("encrypted_key").notNull(),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
    updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.provider] })]
);

export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    auth_type: text("auth_type").notNull().default("none"),
    scope: text("scope", { enum: ["global", "sandbox"] })
      .notNull()
      .default("global"),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
    updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_mcp_servers_user").on(table.user_id),
    index("idx_mcp_servers_user_scope").on(table.user_id, table.scope),
  ]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().notNull(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    model: text("model"),
    tokens_in: integer("tokens_in").default(0),
    tokens_out: integer("tokens_out").default(0),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_messages_conv_created").on(
      table.conversation_id,
      table.created_at
    ),
  ]
);

/** Tracks specialist agents per conversation+role.
 *  The composite PK (conversation_id, role) doubles as an index covering
 *  lookups by conversation_id alone (SQLite uses leftmost prefix). */
export const conversationAgents = sqliteTable(
  "conversation_agents",
  {
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    letta_agent_id: text("letta_agent_id").notNull(),
    created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.conversation_id, table.role] })]
);
