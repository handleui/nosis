import { streamText } from "ai";
import { invoke } from "@tauri-apps/api/core";
import type { LettaProvider } from "@letta-ai/vercel-ai-sdk-provider";
import {
  getLettaApiKey,
  createLettaProvider,
  createAgentForConversation,
} from "./letta";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamCallbacks {
  onToken: (content: string) => void;
  onDone?: (fullContent: string) => void;
  onError?: (message: string) => void;
}

interface ConversationRecord {
  id: string;
  letta_agent_id: string | null;
}

let cachedProvider: { apiKey: string; provider: LettaProvider } | null = null;

function getOrCreateProvider(apiKey: string): LettaProvider {
  if (cachedProvider?.apiKey === apiKey) {
    return cachedProvider.provider;
  }
  const provider = createLettaProvider(apiKey);
  cachedProvider = { apiKey, provider };
  return provider;
}

export function clearProviderCache(): void {
  cachedProvider = null;
}

async function resolveAgentId(
  conversationId: string,
  provider: LettaProvider
): Promise<string> {
  const conversation = await invoke<ConversationRecord>("get_conversation", {
    id: conversationId,
  });

  if (conversation.letta_agent_id) {
    return conversation.letta_agent_id;
  }

  return createAgentForConversation(provider, conversationId);
}

function saveAssistantMessage(
  conversationId: string,
  content: string
): Promise<unknown> {
  return invoke("save_message", {
    conversationId,
    role: "assistant",
    content,
    model: null,
    tokensIn: null,
    tokensOut: null,
  });
}

function redactTokens(message: string): string {
  const patterns: [RegExp, string][] = [
    [
      /\b(sk-ant-|sk-|letta-|exa-|xai-|key-)[A-Za-z0-9_-]{10,}\b/g,
      "[REDACTED]",
    ],
    [/\bBearer\s+[A-Za-z0-9_\-.]{10,}\b/g, "[REDACTED]"],
    [
      /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
      "[REDACTED]",
    ],
  ];

  let safe = message;
  for (const [pattern, replacement] of patterns) {
    safe = safe.replace(pattern, replacement);
  }
  return safe;
}

interface StreamAccumulator {
  chunks: string[];
}

function joinAccumulator(accumulator: StreamAccumulator): string {
  return accumulator.chunks.join("");
}

async function executeStream(
  conversationId: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  abortSignal: AbortSignal,
  accumulator: StreamAccumulator
): Promise<void> {
  const apiKey = await getLettaApiKey();
  const letta = getOrCreateProvider(apiKey);
  const agentId = await resolveAgentId(conversationId, letta);

  const latestMessage = messages.at(-1);
  if (!latestMessage) {
    throw new Error("No messages to send");
  }

  const result = streamText({
    model: letta(),
    providerOptions: {
      letta: { agent: { id: agentId, streamTokens: true } },
    },
    prompt: latestMessage.content,
    abortSignal,
  });

  for await (const chunk of result.textStream) {
    accumulator.chunks.push(chunk);
    callbacks.onToken(chunk);
  }

  const fullContent = joinAccumulator(accumulator);
  await saveAssistantMessage(conversationId, fullContent);
  callbacks.onDone?.(fullContent);
}

async function handleStreamError(
  err: unknown,
  conversationId: string,
  accumulator: StreamAccumulator,
  callbacks: StreamCallbacks
): Promise<void> {
  if (err instanceof Error && err.name === "AbortError") {
    const fullContent = joinAccumulator(accumulator);
    if (fullContent) {
      await saveAssistantMessage(conversationId, fullContent).catch(() => {
        // Best-effort save on abort; swallow errors to avoid masking the abort.
      });
    }
    callbacks.onDone?.(fullContent);
    return;
  }

  const raw = err instanceof Error ? err.message : "Stream failed";
  callbacks.onError?.(redactTokens(raw));
}

export function streamChat(
  conversationId: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks
): { promise: Promise<void>; cancel: () => void } {
  const abortController = new AbortController();
  const accumulator: StreamAccumulator = { chunks: [] };

  const promise = executeStream(
    conversationId,
    messages,
    callbacks,
    abortController.signal,
    accumulator
  ).catch((err) =>
    handleStreamError(err, conversationId, accumulator, callbacks)
  );

  return {
    promise,
    cancel: () => abortController.abort(),
  };
}
