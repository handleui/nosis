import {
  consumeStream,
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
  type StepResult,
  type ToolSet,
  type UIMessage,
} from "ai";
import { resolveOrCreateAgentId } from "@nosis/agent-runtime";
import { canonicalizeExecutionTarget } from "@nosis/agent-runtime/execution";
import { createProvider } from "@nosis/provider";
import { HTTPException } from "hono/http-exception";
import { buildSkillSystemPrompt, type ChatSkillId } from "./chat-skills";
import {
  type AppDatabase,
  getConversationRuntime,
  saveMessageBatch,
  trySetConversationAgentId,
} from "./db";
import { getActiveTools } from "./mcp";
import { sanitizeError } from "./sanitize";
import type { Bindings } from "./types";

const MAX_AGENT_STEPS = 8;
const MAX_CONTEXT_MESSAGES = 24;
const MAX_STEP_CONTEXT_MESSAGES = 18;
const MAX_STORAGE_CHARS = 100_000;
const MAX_ABORT_CAPTURE_CHARS = 200_000;

export interface StreamChatInput {
  content?: string;
  messages?: UIMessage[];
  trigger: "submit-message" | "regenerate-message";
  skillIds: readonly ChatSkillId[];
}

function trimForStorage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_STORAGE_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_STORAGE_CHARS - 29)}\n\n[Truncated for storage]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summarizeUrlData(data: Record<string, unknown>): string {
  const title = typeof data.title === "string" ? data.title : "Attached URL";
  const url = typeof data.url === "string" ? data.url : undefined;
  const content = typeof data.content === "string" ? data.content : undefined;
  const header = url ? `[${title}](${url})` : title;
  const excerpt = content ? content.slice(0, 12_000) : "";
  return excerpt.length > 0 ? `${header}\n\n${excerpt}` : header;
}

function summarizeCodeFileData(data: Record<string, unknown>): string {
  const filename =
    typeof data.filename === "string" ? data.filename : "attached-file";
  const language = typeof data.language === "string" ? data.language : "text";
  const code = typeof data.code === "string" ? data.code : "";
  const snippet = code.slice(0, 12_000);
  return `\`\`\`${language}\n// ${filename}\n${snippet}\n\`\`\``;
}

function summarizeGenericData(
  type: string,
  data: Record<string, unknown>
): string | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return `[${type}] [Unserializable data payload]`;
  }
  if (!serialized || serialized.length <= 2) {
    return null;
  }
  return `[${type}] ${serialized.slice(0, 6000)}`;
}

function summarizeDataPart(part: {
  type: string;
  data: unknown;
}): string | null {
  if (!isRecord(part.data)) {
    return null;
  }

  if (part.type === "data-url") {
    return summarizeUrlData(part.data);
  }
  if (part.type === "data-code-file") {
    return summarizeCodeFileData(part.data);
  }

  return summarizeGenericData(part.type, part.data);
}

function summarizeUserMessageForStorage(message: UIMessage): string {
  const chunks: string[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text.length > 0) {
        chunks.push(text);
      }
      continue;
    }

    if (part.type === "file") {
      const label = part.filename ?? part.mediaType ?? part.url.slice(0, 120);
      chunks.push(`[Attached file: ${label}]`);
      continue;
    }

    if (part.type.startsWith("data-") && "data" in part) {
      const summary = summarizeDataPart({ type: part.type, data: part.data });
      if (summary) {
        chunks.push(summary);
      }
    }
  }

  if (chunks.length === 0) {
    return "[Sent non-text content]";
  }

  return trimForStorage(chunks.join("\n\n"));
}

function latestUserMessage(messages: readonly UIMessage[]): UIMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user") {
      return message;
    }
  }
  return null;
}

function compactModelMessages(
  messages: ModelMessage[],
  maxMessages: number
): ModelMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  if (messages[0]?.role === "system") {
    return [messages[0], ...messages.slice(-(maxMessages - 1))];
  }

  return messages.slice(-maxMessages);
}

function pruneForPrompt(
  messages: ModelMessage[],
  maxMessages: number
): ModelMessage[] {
  const pruned = pruneMessages({
    messages,
    reasoning: "before-last-message",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  });
  return compactModelMessages(pruned, maxMessages);
}

async function toModelMessages(messages: UIMessage[]): Promise<ModelMessage[]> {
  const normalized = messages.map(({ id: _id, ...message }) => message);
  const converted = await convertToModelMessages(normalized, {
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) => {
      const summary = summarizeDataPart({ type: part.type, data: part.data });
      if (!summary) {
        return undefined;
      }
      return { type: "text", text: summary };
    },
  });

  return pruneForPrompt(converted, MAX_CONTEXT_MESSAGES);
}

function toTokenCounts(usage: LanguageModelUsage): { in: number; out: number } {
  return {
    in: usage.inputTokens ?? 0,
    out: usage.outputTokens ?? 0,
  };
}

function summarizeAbort(steps: readonly StepResult<ToolSet>[]): {
  text: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
} {
  const text = trimForStorage(
    steps
      .map((step) => step.text)
      .join("")
      .trim()
  );
  const model = steps.at(-1)?.model.modelId ?? null;
  const usage = steps.reduce(
    (acc, step) => {
      acc.tokensIn += step.usage.inputTokens ?? 0;
      acc.tokensOut += step.usage.outputTokens ?? 0;
      return acc;
    },
    { tokensIn: 0, tokensOut: 0 }
  );

  return { text, model, ...usage };
}
export async function streamChat(
  db: AppDatabase,
  lettaApiKey: string,
  conversationId: string,
  userId: string,
  officeId: string,
  input: StreamChatInput,
  ctx: ExecutionContext,
  env: Bindings
): Promise<Response> {
  const runtime = await getConversationRuntime(db, conversationId, userId);
  const provider = createProvider(lettaApiKey);
  const agentId = await resolveOrCreateAgentId({
    provider,
    agentSeed: conversationId,
    getExistingAgentId: async () => runtime.letta_agent_id,
    claimAgentId: async (newAgentId) =>
      await trySetConversationAgentId(db, conversationId, userId, newAgentId),
    getWinningAgentId: async () => {
      const winnerRuntime = await getConversationRuntime(
        db,
        conversationId,
        userId
      );
      return winnerRuntime.letta_agent_id;
    },
    schedule: (task) => ctx.waitUntil(task),
    onError: (message, error) => {
      console.error(message, sanitizeError(error, [lettaApiKey]));
    },
    errorContext: `conversation=${conversationId}`,
  }).catch((error: unknown) => {
    throw new HTTPException(500, {
      message:
        error instanceof Error
          ? error.message
          : "Failed to resolve agent for conversation",
    });
  });

  const modelMessages = input.messages
    ? await toModelMessages(input.messages)
    : null;
  const messagesForModel =
    modelMessages && modelMessages.length > 0 ? modelMessages : undefined;
  if (!(messagesForModel || input.content)) {
    throw new HTTPException(400, {
      message: "messages must contain at least one usable part",
    });
  }

  const latestUser = input.messages ? latestUserMessage(input.messages) : null;
  const userContent = latestUser
    ? summarizeUserMessageForStorage(latestUser)
    : (input.content?.trim() ?? "");
  const shouldPersistUserMessage = input.trigger !== "regenerate-message";

  if (shouldPersistUserMessage && userContent.length === 0) {
    throw new HTTPException(400, {
      message: "Could not determine user message content to persist",
    });
  }

  // Save user message and load MCP tools in parallel (independent operations)
  const toolsTask = getActiveTools(
    db,
    env,
    userId,
    officeId,
    canonicalizeExecutionTarget(runtime.execution_target)
  );
  let toolsResult: Awaited<typeof toolsTask>;
  if (shouldPersistUserMessage) {
    const [loadedTools] = await Promise.all([
      toolsTask,
      saveMessageBatch(
        db,
        crypto.randomUUID(),
        conversationId,
        "user",
        trimForStorage(userContent),
        null,
        0,
        0
      ),
    ]);
    toolsResult = loadedTools;
  } else {
    toolsResult = await toolsTask;
  }

  const { tools, cleanup } = toolsResult;

  const hasTools = Object.keys(tools).length > 0;
  const systemPrompt = buildSkillSystemPrompt(input.skillIds);
  const streamedTextChunks: string[] = [];
  let streamedTextLength = 0;

  let finalized = false;
  const finalize = (task: () => Promise<void>): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    ctx.waitUntil(
      task().catch((error: unknown) => {
        console.error(
          `Failed finalization [conversation=${conversationId}]:`,
          sanitizeError(error, [lettaApiKey])
        );
      })
    );
  };

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: provider(),
      providerOptions: {
        letta: {
          agent: { id: agentId, streamTokens: true },
          timeoutInSeconds: 300,
        },
      },
      ...(systemPrompt && { system: systemPrompt }),
      ...(messagesForModel
        ? { messages: messagesForModel }
        : {
            prompt: input.content ?? userContent,
          }),
      ...(hasTools && { tools }),
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      prepareStep: async ({ messages }) => ({
        messages:
          messages.length > MAX_STEP_CONTEXT_MESSAGES
            ? pruneForPrompt(messages, MAX_STEP_CONTEXT_MESSAGES)
            : messages,
      }),
      onChunk({ chunk }) {
        if (chunk.type !== "text-delta") {
          return;
        }
        if (streamedTextLength >= MAX_ABORT_CAPTURE_CHARS) {
          return;
        }
        const next = chunk.text.slice(
          0,
          MAX_ABORT_CAPTURE_CHARS - streamedTextLength
        );
        if (next.length === 0) {
          return;
        }
        streamedTextChunks.push(next);
        streamedTextLength += next.length;
      },
      onFinish({ text, model, totalUsage }) {
        finalize(async () => {
          try {
            const finalText = trimForStorage(text);
            if (finalText.length > 0) {
              const tokens = toTokenCounts(totalUsage);
              await saveMessageBatch(
                db,
                crypto.randomUUID(),
                conversationId,
                "assistant",
                finalText,
                model.modelId,
                tokens.in,
                tokens.out
              );
            }
          } finally {
            await cleanup().catch(() => undefined);
          }
        });
      },
      onAbort({ steps }) {
        finalize(async () => {
          try {
            const partial = summarizeAbort(steps);
            const streamed = trimForStorage(streamedTextChunks.join(""));
            const text = streamed.length > 0 ? streamed : partial.text;
            if (text.length > 0) {
              await saveMessageBatch(
                db,
                crypto.randomUUID(),
                conversationId,
                "assistant",
                text,
                partial.model,
                partial.tokensIn,
                partial.tokensOut
              );
            }
          } finally {
            await cleanup().catch(() => undefined);
          }
        });
      },
      onError({ error }) {
        console.error(
          "streamText error:",
          sanitizeError(error, [lettaApiKey, env.BETTER_AUTH_SECRET])
        );
      },
    });
  } catch (error: unknown) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  // Streaming bypasses Hono's secureHeaders() — reapply manually
  return result.toUIMessageStreamResponse({
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
    consumeSseStream: ({ stream }) =>
      consumeStream({
        stream,
        onError: (error: unknown) => {
          console.error(
            `SSE consume error [conversation=${conversationId}]:`,
            sanitizeError(error, [lettaApiKey, env.BETTER_AUTH_SECRET])
          );
        },
      }),
  });
}
