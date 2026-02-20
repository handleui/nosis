import { streamText } from "ai";
import { createAgent, createProvider } from "@nosis/provider";
import { HTTPException } from "hono/http-exception";
import {
  type AppDatabase,
  getConversationAgentId,
  saveMessageBatch,
  trySetConversationAgentId,
} from "./db";
import { getActiveTools } from "./mcp";
import { sanitizeError } from "./sanitize";
import type { Bindings } from "./types";

/** Resolve or create the Letta agent for a conversation (race-safe). */
async function resolveAgentId(
  provider: ReturnType<typeof createProvider>,
  db: AppDatabase,
  conversationId: string,
  userId: string,
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
    userId,
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

  const winnerAgentId = await getConversationAgentId(
    db,
    conversationId,
    userId
  );
  if (!winnerAgentId) {
    throw new HTTPException(500, {
      message: "Failed to resolve agent for conversation",
    });
  }
  return winnerAgentId;
}

export async function streamChat(
  db: AppDatabase,
  lettaApiKey: string,
  conversationId: string,
  userId: string,
  content: string,
  ctx: ExecutionContext,
  env: Bindings
): Promise<Response> {
  // Lightweight lookup — only fetches letta_agent_id, not the full conversation row
  const existingAgentId = await getConversationAgentId(
    db,
    conversationId,
    userId
  );
  const provider = createProvider(lettaApiKey);
  const agentId = await resolveAgentId(
    provider,
    db,
    conversationId,
    userId,
    existingAgentId,
    ctx,
    lettaApiKey
  );

  // Save user message and load MCP tools in parallel (independent operations)
  const [, { tools, cleanup }] = await Promise.all([
    saveMessageBatch(
      db,
      crypto.randomUUID(),
      conversationId,
      "user",
      content,
      null,
      0,
      0
    ),
    getActiveTools(db, env, userId),
  ]);
  const hasTools = Object.keys(tools).length > 0;

  const result = streamText({
    model: provider(),
    providerOptions: {
      letta: {
        agent: { id: agentId, streamTokens: true },
        timeoutInSeconds: 300,
      },
    },
    prompt: content,
    ...(hasTools && { tools }),
    onError({ error }) {
      console.error("streamText error:", sanitizeError(error, [lettaApiKey]));
    },
  });

  // Persist assistant reply and clean up MCP clients after stream completes.
  // Both must wait for the stream to finish: the save needs the full text,
  // and MCP clients must stay open for tool calls during streaming.
  ctx.waitUntil(
    (async () => {
      try {
        const text = await result.text;
        if (text.trim().length > 0) {
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
        }
      } catch (err: unknown) {
        console.error(
          `Failed to save assistant message [conversation=${conversationId}]:`,
          sanitizeError(err, [lettaApiKey])
        );
      } finally {
        await cleanup().catch(() => undefined);
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
