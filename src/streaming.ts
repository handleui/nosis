import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { invoke } from "@tauri-apps/api/core";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamCallbacks {
  onToken: (content: string) => void;
  onDone?: (fullContent: string, model: string) => void;
  onError?: (message: string) => void;
}

export function streamChat(
  conversationId: string,
  messages: ChatMessage[],
  model: string,
  callbacks: StreamCallbacks
): { promise: Promise<void>; cancel: () => void } {
  const abortController = new AbortController();

  // Collect chunks in an array to avoid O(n^2) string concatenation per token.
  const chunks: string[] = [];

  const promise = (async () => {
    const apiKey = await invoke<string | null>("get_api_key", {
      provider: "anthropic",
    });
    if (!apiKey) {
      throw new Error(
        "Anthropic API key not configured. Use store_api_key to set it."
      );
    }

    const anthropic = createAnthropic({ apiKey });

    const result = streamText({
      model: anthropic(model),
      messages,
      maxOutputTokens: 4096,
      abortSignal: abortController.signal,
    });
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
      callbacks.onToken(chunk);
    }

    const fullContent = chunks.join("");

    const usage = await Promise.resolve(result.usage).catch(() => ({
      inputTokens: null,
      outputTokens: null,
    }));

    await invoke("save_message", {
      conversationId,
      role: "assistant",
      content: fullContent,
      model,
      tokensIn: usage.inputTokens ?? null,
      tokensOut: usage.outputTokens ?? null,
    });

    callbacks.onDone?.(fullContent, model);
  })().catch(async (err) => {
    const fullContent = chunks.join("");
    if (err.name === "AbortError") {
      if (fullContent) {
        await invoke("save_message", {
          conversationId,
          role: "assistant",
          content: fullContent,
          model,
          tokensIn: null,
          tokensOut: null,
        }).catch(() => {
          // Best-effort save on abort; failure is non-critical
        });
      }
      callbacks.onDone?.(fullContent, model);
      return;
    }
    // Sanitize error messages to prevent accidental API key leakage.
    // SDK/HTTP errors may include headers or URLs containing the key.
    const raw = err.message ?? "Stream failed";
    const safe = raw.replace(
      /\b(sk-ant-|sk-)[A-Za-z0-9_-]{10,}\b/g,
      "[REDACTED]"
    );
    callbacks.onError?.(safe);
  });

  return {
    promise,
    cancel: () => abortController.abort(),
  };
}
