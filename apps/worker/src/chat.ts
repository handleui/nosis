import { generateText, jsonSchema, stepCountIs, streamText, tool } from "ai";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_HUMAN,
  DEFAULT_MODEL,
  createAgent,
  createProvider,
} from "@nosis/provider";
import { HTTPException } from "hono/http-exception";
import {
  type AppDatabase,
  getConversationAgent,
  getConversationAgentId,
  saveMessageBatch,
  trySetConversationAgent,
  trySetConversationAgentId,
} from "./db";
import { getActiveTools } from "./mcp";
import { sanitizeError, sanitizeRole } from "./sanitize";
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

/** Max research tool calls per request — prevents unbounded Letta sub-calls. */
const MAX_RESEARCH_CALLS_PER_REQUEST = 5;

/**
 * Resolve or create a specialist Letta agent for a given role (race-safe).
 * Orphan cleanup mirrors the main agent pattern.
 */
async function resolveSpecialistAgentId(
  provider: ReturnType<typeof createProvider>,
  db: AppDatabase,
  conversationId: string,
  userId: string,
  role: string,
  ctx: ExecutionContext,
  lettaApiKey: string
): Promise<string> {
  const safeRole = sanitizeRole(role);

  const existing = await getConversationAgent(
    db,
    conversationId,
    userId,
    safeRole
  );
  if (existing) {
    return existing;
  }

  const agent = await provider.client.agents.create({
    name: `nosis-${safeRole}-${conversationId.slice(0, 8)}`,
    model: DEFAULT_MODEL,
    contextWindowLimit: DEFAULT_CONTEXT_WINDOW,
    memoryBlocks: [
      {
        label: "persona",
        value:
          "You are a focused research specialist. Provide accurate, concise answers with citations when available.",
        limit: 2000,
      },
      { label: "human", value: DEFAULT_HUMAN, limit: 5000 },
    ],
  });

  const won = await trySetConversationAgent(
    db,
    conversationId,
    userId,
    safeRole,
    agent.id
  );
  if (won) {
    return agent.id;
  }

  // Lost the race — clean up orphan and use the winner's agent
  ctx.waitUntil(
    provider.client.agents.delete(agent.id).catch((err: unknown) => {
      console.error(
        "Failed to delete orphan specialist agent:",
        sanitizeError(err, [lettaApiKey])
      );
    })
  );

  const winnerId = await getConversationAgent(
    db,
    conversationId,
    userId,
    safeRole
  );
  if (!winnerId) {
    throw new HTTPException(500, {
      message: "Failed to resolve specialist agent",
    });
  }
  return winnerId;
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
  // Lightweight lookup — verifies ownership and fetches agent ID.
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

  // Save user message and load MCP tools in parallel, both after agent resolution
  // succeeds — if resolveAgentId throws, no message is persisted and the request
  // is safely retriable without duplicates.
  const [, { tools: mcpTools, cleanup }] = await Promise.all([
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

  // Request-scoped cache: avoids repeated D1 lookups when the main agent calls
  // the research tool multiple times within a single conversation turn.
  let cachedSpecialistId: string | null = null;

  // Request-scoped counter: prevents resource exhaustion from unbounded tool calls.
  let researchCallCount = 0;

  if ("research" in mcpTools) {
    console.warn(
      `[chat] MCP tool named "research" will be overridden by the built-in research tool [conversation=${conversationId}]`
    );
  }

  const tools = {
    ...mcpTools,
    research: tool({
      description:
        "Delegate a focused research subtask to a specialist agent. Use this when you need to look up facts, explore a topic in depth, or gather information before answering.",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            maxLength: 500,
            description: "The research question or topic to investigate.",
          },
        },
        required: ["query"],
      }),
      execute: async ({ query }) => {
        // jsonSchema() constraints are advisory only — enforce at runtime.
        if (typeof query !== "string" || query.length > 500) {
          return "Research query exceeds maximum allowed length.";
        }
        const trimmedQuery = query.trim();
        if (trimmedQuery.length === 0) {
          return "Research query must not be empty.";
        }

        researchCallCount += 1;
        if (researchCallCount > MAX_RESEARCH_CALLS_PER_REQUEST) {
          return "Research tool call limit reached for this request.";
        }

        try {
          if (!cachedSpecialistId) {
            cachedSpecialistId = await resolveSpecialistAgentId(
              provider,
              db,
              conversationId,
              userId,
              "research",
              ctx,
              lettaApiKey
            );
          }
        } catch (err: unknown) {
          const sanitized = sanitizeError(err, [lettaApiKey]);
          console.error("Research specialist resolution error:", sanitized);
          return `Failed to initialize research specialist: ${sanitized}`;
        }

        try {
          const result = await generateText({
            model: provider(),
            providerOptions: {
              letta: {
                agent: { id: cachedSpecialistId },
                timeoutInSeconds: 120,
              },
            },
            prompt: trimmedQuery,
          });
          return result.text;
        } catch (err: unknown) {
          const sanitized = sanitizeError(err, [lettaApiKey]);
          console.error("Research tool error:", sanitized);
          return `Research failed: ${sanitized}`;
        }
      },
    }),
  };

  const result = streamText({
    model: provider(),
    providerOptions: {
      letta: {
        agent: { id: agentId, streamTokens: true },
        timeoutInSeconds: 300,
      },
    },
    prompt: content,
    tools,
    // Two-layer defense against unbounded loops:
    // 1. researchCallCount (primary) — enforced per-tool-call inside execute(),
    //    works correctly even when the model fires multiple parallel calls in
    //    one step because the counter increments synchronously before any await.
    // 2. stepCountIs (secondary) — caps total model round-trips as a safety net
    //    against non-research agentic loops. Set to MAX + 1 because the first
    //    step is the initial prompt, so N+1 steps = N tool-response cycles.
    stopWhen: stepCountIs(MAX_RESEARCH_CALLS_PER_REQUEST + 1),
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
