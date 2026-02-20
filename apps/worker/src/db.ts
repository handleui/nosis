import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import {
  conversationAgents,
  conversations,
  mcpServers,
  messages,
  userApiKeys,
} from "./schema";
import type * as schema from "./schema";
import type { Conversation, McpServer, Message } from "./types";

export type AppDatabase = DrizzleD1Database<typeof schema>;
export type MessageRole = (typeof messages.$inferInsert)["role"];

export interface UserApiKeyMeta {
  provider: string;
  created_at: string;
  updated_at: string;
}

function notFound(entity: string): never {
  throw new HTTPException(404, { message: `${entity} not found` });
}

// ── User API Keys ──

export async function upsertUserApiKey(
  db: AppDatabase,
  userId: string,
  provider: string,
  encryptedKey: string
): Promise<void> {
  await db
    .insert(userApiKeys)
    .values({
      user_id: userId,
      provider,
      encrypted_key: encryptedKey,
    })
    .onConflictDoUpdate({
      target: [userApiKeys.user_id, userApiKeys.provider],
      set: {
        encrypted_key: encryptedKey,
        updated_at: sql`datetime('now')`,
      },
    });
}

export async function listUserApiKeys(
  db: AppDatabase,
  userId: string
): Promise<UserApiKeyMeta[]> {
  return await db
    .select({
      provider: userApiKeys.provider,
      created_at: userApiKeys.created_at,
      updated_at: userApiKeys.updated_at,
    })
    .from(userApiKeys)
    .where(eq(userApiKeys.user_id, userId))
    .orderBy(asc(userApiKeys.provider));
}

export async function deleteUserApiKey(
  db: AppDatabase,
  userId: string,
  provider: string
): Promise<void> {
  const result = await db
    .delete(userApiKeys)
    .where(
      and(eq(userApiKeys.user_id, userId), eq(userApiKeys.provider, provider))
    )
    .returning({ user_id: userApiKeys.user_id });

  if (result.length === 0) {
    notFound(`API key for provider "${provider}"`);
  }
}

// ── MCP Servers ──

export async function addMcpServer(
  db: AppDatabase,
  id: string,
  userId: string,
  name: string,
  url: string,
  authType: string
): Promise<McpServer> {
  const row = await db
    .insert(mcpServers)
    .values({ id, user_id: userId, name, url, auth_type: authType })
    .returning()
    .get();

  if (!row) {
    throw new HTTPException(500, { message: "Failed to add MCP server" });
  }
  return row;
}

export async function listMcpServers(
  db: AppDatabase,
  userId: string
): Promise<McpServer[]> {
  return await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.user_id, userId))
    .orderBy(asc(mcpServers.created_at));
}

export async function deleteMcpServer(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.id, id), eq(mcpServers.user_id, userId)))
    .returning({ id: mcpServers.id });

  return result.length > 0;
}

// ── Conversations ──

export async function createConversation(
  db: AppDatabase,
  id: string,
  userId: string,
  title: string
): Promise<Conversation> {
  const row = await db
    .insert(conversations)
    .values({ id, user_id: userId, title })
    .returning()
    .get();

  if (!row) {
    throw new HTTPException(500, {
      message: "Failed to create conversation",
    });
  }
  return row;
}

export async function listConversations(
  db: AppDatabase,
  userId: string,
  limit: number,
  offset: number
): Promise<Conversation[]> {
  return await db
    .select()
    .from(conversations)
    .where(eq(conversations.user_id, userId))
    .orderBy(desc(conversations.updated_at))
    .limit(limit)
    .offset(offset);
}

export async function getConversation(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Conversation> {
  const row = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .get();

  if (!row) {
    notFound("Conversation");
  }
  return row;
}

export async function updateConversationTitle(
  db: AppDatabase,
  id: string,
  userId: string,
  title: string
): Promise<void> {
  const result = await db
    .update(conversations)
    .set({ title, updated_at: sql`datetime('now')` })
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

export async function deleteConversation(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<void> {
  const result = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

export async function setConversationAgentId(
  db: AppDatabase,
  id: string,
  userId: string,
  agentId: string
): Promise<void> {
  const result = await db
    .update(conversations)
    .set({ letta_agent_id: agentId, updated_at: sql`datetime('now')` })
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

/** Atomically set agent ID only if not already set. Returns true if this call won. */
export async function trySetConversationAgentId(
  db: AppDatabase,
  id: string,
  userId: string,
  agentId: string
): Promise<boolean> {
  const result = await db
    .update(conversations)
    .set({ letta_agent_id: agentId, updated_at: sql`datetime('now')` })
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.user_id, userId),
        isNull(conversations.letta_agent_id)
      )
    )
    .returning({ id: conversations.id });
  return result.length > 0;
}

/**
 * Lightweight lookup returning only the agent ID (or null). Throws 404 if not found
 * or not owned by userId.
 */
export async function getConversationAgentId(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<string | null> {
  const row = await db
    .select({ letta_agent_id: conversations.letta_agent_id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .get();

  if (!row) {
    notFound("Conversation");
  }
  return row.letta_agent_id;
}

// ── Conversation Agents ──

/**
 * Return the Letta agent ID for a specialist role, or null if not yet created.
 * Scoped to userId via a join on conversations to prevent cross-user IDOR.
 */
export async function getConversationAgent(
  db: AppDatabase,
  conversationId: string,
  userId: string,
  role: string
): Promise<string | null> {
  const row = await db
    .select({ letta_agent_id: conversationAgents.letta_agent_id })
    .from(conversationAgents)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, conversationAgents.conversation_id),
        eq(conversations.user_id, userId)
      )
    )
    .where(
      and(
        eq(conversationAgents.conversation_id, conversationId),
        eq(conversationAgents.role, role)
      )
    )
    .get();
  return row?.letta_agent_id ?? null;
}

/**
 * Insert a specialist agent ID for a role only if not already set.
 * Verifies conversation ownership (userId) before inserting to prevent cross-user IDOR.
 * Returns true if this call won the race; false if the user doesn't own the conversation
 * or another request already inserted a row for this role.
 */
export async function trySetConversationAgent(
  db: AppDatabase,
  conversationId: string,
  userId: string,
  role: string,
  agentId: string
): Promise<boolean> {
  const owned = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.user_id, userId)
      )
    )
    .get();

  if (!owned) {
    return false;
  }

  const inserted = await db
    .insert(conversationAgents)
    .values({
      conversation_id: conversationId,
      role,
      letta_agent_id: agentId,
    })
    .onConflictDoNothing()
    .returning({ conversation_id: conversationAgents.conversation_id });

  return inserted.length > 0;
}

// ── Messages ──

export async function getMessages(
  db: AppDatabase,
  conversationId: string,
  userId: string,
  limit: number,
  offset: number
): Promise<Message[]> {
  const [convCheck, msgs] = await db.batch([
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.user_id, userId)
        )
      ),
    db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, conversationId))
      .orderBy(asc(messages.created_at))
      .limit(limit)
      .offset(offset),
  ]);

  if (convCheck.length === 0) {
    notFound("Conversation");
  }

  return msgs;
}

export async function saveMessage(
  db: AppDatabase,
  id: string,
  conversationId: string,
  userId: string,
  role: MessageRole,
  content: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number
): Promise<Message> {
  // Verify ownership BEFORE inserting. D1 batch executes all statements
  // regardless of earlier results, so a single batch would insert the message
  // even when the ownership check fails (TOCTOU authorization bypass).
  const convCheck = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.user_id, userId)
      )
    )
    .get();

  if (!convCheck) {
    notFound("Conversation");
  }

  // Ownership confirmed — touch updated_at and insert in one batch.
  const [, inserted] = await db.batch([
    db
      .update(conversations)
      .set({ updated_at: sql`datetime('now')` })
      .where(eq(conversations.id, conversationId)),
    db
      .insert(messages)
      .values({
        id,
        conversation_id: conversationId,
        role,
        content,
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      })
      .returning(),
  ]);

  const row = inserted[0];
  if (!row) {
    throw new HTTPException(500, { message: "Failed to save message" });
  }
  return row;
}

/** Insert a message without a conversation-ownership check.
 *  SECURITY: Callers MUST verify conversation ownership before calling.
 *  Used only from streamChat() for the post-stream assistant-message save,
 *  where ownership was already validated by getConversationAgentId().
 *  Skips `.returning()` to avoid sending the (potentially large) content
 *  column back over the D1 wire — no caller uses the returned row.
 */
export async function saveMessageBatch(
  db: AppDatabase,
  id: string,
  conversationId: string,
  role: MessageRole,
  content: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number
): Promise<void> {
  await db.batch([
    db
      .update(conversations)
      .set({ updated_at: sql`datetime('now')` })
      .where(eq(conversations.id, conversationId)),
    db.insert(messages).values({
      id,
      conversation_id: conversationId,
      role,
      content,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    }),
  ]);
}

/**
 * Fetch the agent ID for a conversation AND save a user message atomically.
 * Ownership is verified first via a standalone SELECT — only if that passes
 * are the UPDATE (touch updated_at) and INSERT (user message) batched together.
 *
 * Throws 404 if the conversation doesn't exist or isn't owned by userId.
 */
export async function getAgentIdAndSaveMessage(
  db: AppDatabase,
  conversationId: string,
  userId: string,
  messageId: string,
  content: string
): Promise<string | null> {
  // Verify ownership first — D1 batch() executes all statements unconditionally,
  // so we must confirm ownership in a standalone query before running any writes.
  const agentRow = await db
    .select({ letta_agent_id: conversations.letta_agent_id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.user_id, userId)
      )
    )
    .get();

  if (!agentRow) {
    notFound("Conversation");
  }

  // Ownership confirmed — batch the UPDATE + INSERT together.
  await db.batch([
    db
      .update(conversations)
      .set({ updated_at: sql`datetime('now')` })
      .where(eq(conversations.id, conversationId)),
    db.insert(messages).values({
      id: messageId,
      conversation_id: conversationId,
      role: "user",
      content,
      model: null,
      tokens_in: 0,
      tokens_out: 0,
    }),
  ]);

  return agentRow.letta_agent_id;
}
