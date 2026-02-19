import { streamText } from "ai";
import { createAgent, createProvider } from "@nosis/provider";
import { HTTPException } from "hono/http-exception";
import {
  getConversation,
  saveMessageBatch,
  trySetConversationAgentId,
} from "./db";
import { sanitizeError } from "./sanitize";

/** Resolve or create the Letta agent for a conversation (race-safe). */
async function resolveAgentId(
  provider: ReturnType<typeof createProvider>,
  db: D1Database,
  conversationId: string,
  existingAgentId: string | null,
  ctx: ExecutionContext,
  lettaApiKey: string
): Promise<string> {
  if (existingAgentId) {
    return existingAgentId;
  }

  const newAgentId = await createAgent(provider, conversationId);
  const wasSet = await trySetConversationAgentId(
    db,
    conversationId,
    newAgentId
  );
  if (wasSet) {
    return newAgentId;
  }

  // Another request won the race — fire-and-forget orphan cleanup
  ctx.waitUntil(
    provider.client.agents.delete(newAgentId).catch((err: unknown) => {
      console.error(
        "Failed to delete orphan agent:",
        sanitizeError(err, [lettaApiKey])
      );
    })
  );

  const updated = await getConversation(db, conversationId);
  if (!updated.letta_agent_id) {
    throw new HTTPException(500, {
      message: "Failed to resolve agent for conversation",
    });
  }
  return updated.letta_agent_id;
}

export async function streamChat(
  db: D1Database,
  lettaApiKey: string,
  conversationId: string,
  content: string,
  ctx: ExecutionContext
): Promise<Response> {
  if (!lettaApiKey) {
    throw new HTTPException(500, {
      message: "Chat provider not configured",
    });
  }

  const conversation = await getConversation(db, conversationId);
  const provider = createProvider(lettaApiKey);
  const agentId = await resolveAgentId(
    provider,
    db,
    conversationId,
    conversation.letta_agent_id,
    ctx,
    lettaApiKey
  );

  await saveMessageBatch(
    db,
    crypto.randomUUID(),
    conversationId,
    "user",
    content,
    null,
    0,
    0
  );

  const result = streamText({
    model: provider(),
    providerOptions: {
      letta: {
        agent: { id: agentId, streamTokens: true },
        timeoutInSeconds: 300,
      },
    },
    prompt: content,
    onError({ error }) {
      console.error("streamText error:", sanitizeError(error, [lettaApiKey]));
    },
  });

  // Persist assistant reply after stream completes.
  // Runs to completion even if the client disconnects mid-stream —
  // intentional so we always cache the full response in D1.
  ctx.waitUntil(
    (async () => {
      try {
        const text = await result.text;
        if (text.trim().length === 0) {
          return;
        }
        await saveMessageBatch(
          db,
          crypto.randomUUID(),
          conversationId,
          "assistant",
          text,
          null,
          0,
          0
        );
      } catch (err: unknown) {
        console.error(
          `Failed to save assistant message [conversation=${conversationId}]:`,
          sanitizeError(err, [lettaApiKey])
        );
      }
    })()
  );

  // Streaming bypasses Hono's secureHeaders() — reapply manually
  return result.toTextStreamResponse({
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}
