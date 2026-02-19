import { streamText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { invoke } from "@tauri-apps/api/core";
import { getActiveTools } from "./mcp-clients";

const MAX_OUTPUT_TOKENS = 4096;
const MAX_TOOL_STEPS = 10;
const API_KEY_PATTERN = /\b(sk-ant-|sk-)[A-Za-z0-9_-]{10,}\b/g;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamCallbacks {
  onToken: (content: string) => void;
  onDone?: (fullContent: string, model: string) => void;
  onError?: (message: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
}

async function fetchAnthropicKey(): Promise<string> {
  const apiKey = await invoke<string | null>("get_api_key", {
    provider: "anthropic",
  });
  if (!apiKey) {
    throw new Error(
      "Anthropic API key not configured. Use store_api_key to set it."
    );
  }
  return apiKey;
}

async function saveAssistantMessage(
  conversationId: string,
  content: string,
  model: string,
  tokensIn: number | null,
  tokensOut: number | null
): Promise<void> {
  await invoke("save_message", {
    conversationId,
    role: "assistant",
    content,
    model,
    tokensIn,
    tokensOut,
  });
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(API_KEY_PATTERN, "[REDACTED]");
}

async function handleAbort(
  conversationId: string,
  fullContent: string,
  model: string,
  callbacks: StreamCallbacks
): Promise<void> {
  if (fullContent) {
    await saveAssistantMessage(
      conversationId,
      fullContent,
      model,
      null,
      null
    ).catch(() => undefined);
  }
  callbacks.onDone?.(fullContent, model);
}

async function runStream(
  conversationId: string,
  messages: ChatMessage[],
  model: string,
  callbacks: StreamCallbacks,
  abortSignal: AbortSignal
): Promise<string> {
  const apiKey = await fetchAnthropicKey();
  const anthropic = createAnthropic({ apiKey });
  const { tools, cleanup } = await getActiveTools();
  const hasTools = Object.keys(tools).length > 0;

  try {
    const result = streamText({
      model: anthropic(model),
      messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal,
      ...(hasTools && {
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        onStepFinish: ({ toolCalls }) => {
          for (const tc of toolCalls) {
            callbacks.onToolCall?.(tc.toolName, tc.input);
          }
        },
      }),
    });

    let fullContent = "";
    for await (const chunk of result.textStream) {
      fullContent += chunk;
      callbacks.onToken(chunk);
    }

    const usage = await Promise.resolve(result.usage).catch(() => ({
      inputTokens: null,
      outputTokens: null,
    }));

    await saveAssistantMessage(
      conversationId,
      fullContent,
      model,
      usage.inputTokens ?? null,
      usage.outputTokens ?? null
    );

    callbacks.onDone?.(fullContent, model);
    return fullContent;
  } finally {
    await cleanup().catch(() => undefined);
  }
}

export function streamChat(
  conversationId: string,
  messages: ChatMessage[],
  model: string,
  callbacks: StreamCallbacks
): { promise: Promise<void>; cancel: () => void } {
  const abortController = new AbortController();
  let fullContent = "";

  const promise = runStream(
    conversationId,
    messages,
    model,
    callbacks,
    abortController.signal
  )
    .then((content) => {
      fullContent = content;
    })
    .catch(async (err) => {
      if (err.name === "AbortError") {
        await handleAbort(conversationId, fullContent, model, callbacks);
        return;
      }
      const safe = sanitizeErrorMessage(err.message ?? "Stream failed");
      callbacks.onError?.(safe);
    });

  return {
    promise,
    cancel: () => abortController.abort(),
  };
}
