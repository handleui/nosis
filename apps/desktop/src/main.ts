import { invoke } from "@tauri-apps/api/core";
import { streamChat, type ChatMessage } from "./streaming";

declare global {
  interface Window {
    __muppet_invoke: typeof invoke;
    __muppet_streamChat: (
      conversationId: string,
      messages: ChatMessage[],
      model: string
    ) => ReturnType<typeof streamChat>;
  }
}

function setupEscapeDismiss() {
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape") {
      return;
    }

    // Don't intercept Escape when focus is inside form inputs, dialogs, etc.
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        target.closest("dialog[open]"))
    ) {
      return;
    }

    invoke("dismiss_window").catch(() => undefined);
  });
}

const DEV_COMMANDS: Record<string, string[]> = {
  "DB commands": [
    '__muppet_invoke("create_conversation", { title: "Test" })',
    '__muppet_invoke("list_conversations")',
    '__muppet_invoke("get_messages", { conversationId: "..." })',
    '__muppet_invoke("save_message", { conversationId: "...", role: "user", content: "Hello" })',
    '__muppet_invoke("delete_conversation", { id: "..." })',
    '__muppet_invoke("update_conversation_title", { id: "...", title: "New title" })',
  ],
  Settings: [
    '__muppet_invoke("set_setting", { key: "theme", value: "dark" })',
    '__muppet_invoke("get_setting", { key: "theme" })',
  ],
  "API keys": [
    '__muppet_invoke("store_api_key", { provider: "anthropic", apiKey: "..." })',
    '__muppet_invoke("get_api_key", { provider: "anthropic" })',
  ],
  "Exa search": [
    '__muppet_invoke("store_exa_api_key", { key: "exa-..." })',
    '__muppet_invoke("search_web", { query: "latest AI news", numResults: 5 })',
    '__muppet_invoke("has_exa_api_key")',
  ],
  "Fal.ai image generation": [
    '__muppet_invoke("store_fal_api_key", { key: "your-fal-key" })',
    '__muppet_invoke("has_fal_api_key")',
    '__muppet_invoke("delete_fal_api_key")',
    '__muppet_invoke("generate_image", { prompt: "a cat in space" })',
    '__muppet_invoke("generate_image", { prompt: "sunset", model: "fal-ai/flux/dev", imageSize: "landscape_16_9" })',
    '__muppet_invoke("list_generations")',
  ],
  "MCP servers": [
    '__muppet_invoke("add_mcp_server", { name: "test", url: "https://example.com/mcp", authType: "none" })',
    '__muppet_invoke("list_mcp_servers")',
    '__muppet_invoke("delete_mcp_server", { id: "..." })',
  ],
  "Streaming (Anthropic + MCP tools)": [
    'const { promise, cancel } = __muppet_streamChat("conv-id", [{ role: "user", content: "Hello" }], "claude-sonnet-4-20250514")',
    "// call cancel() to abort",
  ],
};

function printDevHelp() {
  console.log("[muppet] DEV MODE — invoke exposed as window.__muppet_invoke()");
  for (const [section, commands] of Object.entries(DEV_COMMANDS)) {
    console.log(`[muppet] ${section}:`);
    for (const cmd of commands) {
      console.log(`  ${cmd}`);
    }
  }
}

function exposeDevGlobals() {
  window.__muppet_invoke = invoke;
  window.__muppet_streamChat = (
    conversationId: string,
    messages: ChatMessage[],
    model: string
  ) =>
    streamChat(conversationId, messages, model, {
      onToken: (t) => console.log("[token]", t),
      onDone: (full) => console.log("\n[done]", full.length, "chars"),
      onError: (msg) => console.error("[error]", msg),
    });
}

setupEscapeDismiss();

// Only expose globals in dev builds — in production this would be an XSS vector.
if (import.meta.env.DEV) {
  exposeDevGlobals();
  printDevHelp();
}
