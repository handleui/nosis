import { HTTPException } from "hono/http-exception";
import type { Conversation, Message } from "./types";

function notFound(entity: string): never {
  throw new HTTPException(404, { message: `${entity} not found` });
}

// ── Conversations ──

export async function createConversation(
  db: D1Database,
  id: string,
  title: string
): Promise<Conversation> {
  const row = await db
    .prepare(
      "INSERT INTO conversations (id, title) VALUES (?, ?) RETURNING id, title, letta_agent_id, created_at, updated_at"
    )
    .bind(id, title)
    .first<Conversation>();

  if (!row) {
    throw new HTTPException(500, {
      message: "Failed to create conversation",
    });
  }
  return row;
}

export async function listConversations(
  db: D1Database,
  limit: number,
  offset: number
): Promise<Conversation[]> {
  const { results } = await db
    .prepare(
      "SELECT id, title, letta_agent_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit, offset)
    .all<Conversation>();

  return results;
}

export async function getConversation(
  db: D1Database,
  id: string
): Promise<Conversation> {
  const row = await db
    .prepare(
      "SELECT id, title, letta_agent_id, created_at, updated_at FROM conversations WHERE id = ?"
    )
    .bind(id)
    .first<Conversation>();

  if (!row) {
    notFound("Conversation");
  }
  return row;
}

export async function updateConversationTitle(
  db: D1Database,
  id: string,
  title: string
): Promise<void> {
  const result = await db
    .prepare(
      "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(title, id)
    .run();

  if (result.meta.changes === 0) {
    notFound("Conversation");
  }
}

export async function deleteConversation(
  db: D1Database,
  id: string
): Promise<void> {
  const result = await db
    .prepare("DELETE FROM conversations WHERE id = ?")
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    notFound("Conversation");
  }
}

export async function setConversationAgentId(
  db: D1Database,
  id: string,
  agentId: string
): Promise<void> {
  const result = await db
    .prepare(
      "UPDATE conversations SET letta_agent_id = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(agentId, id)
    .run();

  if (result.meta.changes === 0) {
    notFound("Conversation");
  }
}

/** Atomically set agent ID only if not already set. Returns true if this call won. */
export async function trySetConversationAgentId(
  db: D1Database,
  id: string,
  agentId: string
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE conversations SET letta_agent_id = ?, updated_at = datetime('now') WHERE id = ? AND letta_agent_id IS NULL"
    )
    .bind(agentId, id)
    .run();
  return result.meta.changes > 0;
}

// ── Messages ──

export async function getMessages(
  db: D1Database,
  conversationId: string,
  limit: number,
  offset: number
): Promise<Message[]> {
  const [convResult, msgResult] = await db.batch([
    db.prepare("SELECT 1 FROM conversations WHERE id = ?").bind(conversationId),
    db
      .prepare(
        "SELECT id, conversation_id, role, content, model, tokens_in, tokens_out, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
      )
      .bind(conversationId, limit, offset),
  ]);

  if (convResult.results.length === 0) {
    notFound("Conversation");
  }

  return msgResult.results as Message[];
}

export async function saveMessage(
  db: D1Database,
  id: string,
  conversationId: string,
  role: string,
  content: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number
): Promise<Message> {
  // Verify existence first — D1 FK errors surface as 500, not 404
  await getConversation(db, conversationId);

  return saveMessageBatch(
    db,
    id,
    conversationId,
    role,
    content,
    model,
    tokensIn,
    tokensOut
  );
}

/** Insert a message without the conversation-existence check. */
export async function saveMessageBatch(
  db: D1Database,
  id: string,
  conversationId: string,
  role: string,
  content: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number
): Promise<Message> {
  const [, insertResult] = await db.batch([
    db
      .prepare(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
      )
      .bind(conversationId),
    db
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, conversation_id, role, content, model, tokens_in, tokens_out, created_at"
      )
      .bind(id, conversationId, role, content, model, tokensIn, tokensOut),
  ]);

  const row = insertResult.results[0] as Message | undefined;
  if (!row) {
    throw new HTTPException(500, { message: "Failed to save message" });
  }
  return row;
}
