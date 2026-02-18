import { streamText } from "ai";
import { invoke } from "@tauri-apps/api/core";
import type { LettaProvider } from "@letta-ai/vercel-ai-sdk-provider";
import {
  getLettaApiKey,
  createLettaProvider,
  createAgentForConversation,
} from "./letta";

export interface StreamCallbacks {
  onToken: (content: string) => void;
  onDone?: (fullContent: string) => void;
  onError?: (message: string) => void;
}

interface ConversationRecord {
  id: string;
  letta_agent_id: string | null;
}

let cachedProvider: { key: string; provider: LettaProvider } | null = null;
const agentIdCache = new Map<string, string>();

function getOrCreateProvider(apiKey: string): LettaProvider {
  if (cachedProvider?.key === apiKey) {
    return cachedProvider.provider;
  }
  const provider = createLettaProvider(apiKey);
  cachedProvider = { key: apiKey, provider };
  return provider;
}

export function clearProviderCache(): void {
  cachedProvider = null;
  agentIdCache.clear();
}

async function resolveAgentId(
  conversationId: string,
  provider: LettaProvider
): Promise<string> {
  const cached = agentIdCache.get(conversationId);
  if (cached) {
    return cached;
  }

  const conversation = await invoke<ConversationRecord>("get_conversation", {
    id: conversationId,
  });

  if (conversation.letta_agent_id) {
    agentIdCache.set(conversationId, conversation.letta_agent_id);
    return conversation.letta_agent_id;
  }

  const agentId = await createAgentForConversation(provider, conversationId);
  agentIdCache.set(conversationId, agentId);
  return agentId;
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

const REDACT_PATTERNS: RegExp[] = [
  /\b(sk[-_]ant[-_]|sk[-_]|letta[-_]|exa[-_]|xai[-_]|key[-_])[A-Za-z0-9_-]{10,}\b/g,
  /\b(Bearer|Basic|Token)\s+[A-Za-z0-9_\-./+=]{10,}\b/g,
  /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

function redactTokens(message: string): string {
  let safe = message;
  for (const pattern of REDACT_PATTERNS) {
    pattern.lastIndex = 0; // Reset stateful /g flag before each use
    safe = safe.replace(pattern, "[REDACTED]");
  }
  return safe;
}

async function executeStream(
  conversationId: string,
  prompt: string,
  callbacks: StreamCallbacks,
  abortSignal: AbortSignal,
  chunks: string[]
): Promise<void> {
  const apiKey = await getLettaApiKey();
  const letta = getOrCreateProvider(apiKey);
  const agentId = await resolveAgentId(conversationId, letta);

  const result = streamText({
    model: letta(),
    providerOptions: {
      letta: { agent: { id: agentId, streamTokens: true } },
    },
    prompt,
    abortSignal,
  });

  for await (const chunk of result.textStream) {
    chunks.push(chunk);
    callbacks.onToken(chunk);
  }

  const fullContent = chunks.join("");
  await saveAssistantMessage(conversationId, fullContent);
  callbacks.onDone?.(fullContent);
}

async function handleStreamError(
  err: unknown,
  conversationId: string,
  chunks: string[],
  callbacks: StreamCallbacks
): Promise<void> {
  if (err instanceof Error && err.name === "AbortError") {
    const fullContent = chunks.join("");
    if (fullContent) {
      await saveAssistantMessage(conversationId, fullContent).catch(() => {
        // Best-effort save on abort
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
  prompt: string,
  callbacks: StreamCallbacks
): { promise: Promise<void>; cancel: () => void } {
  const abortController = new AbortController();
  const chunks: string[] = [];

  const promise = executeStream(
    conversationId,
    prompt,
    callbacks,
    abortController.signal,
    chunks
  ).catch((err) => handleStreamError(err, conversationId, chunks, callbacks));

  return {
    promise,
    cancel: () => abortController.abort(),
  };
}
