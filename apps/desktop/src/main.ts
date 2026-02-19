import { invoke } from "@tauri-apps/api/core";
import { streamChat, type ChatMessage } from "./streaming";

declare global {
  interface Window {
    __nosis_invoke: typeof invoke;
    __nosis_streamChat: (
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
    '__nosis_invoke("create_conversation", { title: "Test" })',
    '__nosis_invoke("list_conversations")',
    '__nosis_invoke("get_messages", { conversationId: "..." })',
    '__nosis_invoke("save_message", { conversationId: "...", role: "user", content: "Hello" })',
    '__nosis_invoke("delete_conversation", { id: "..." })',
    '__nosis_invoke("update_conversation_title", { id: "...", title: "New title" })',
  ],
  Settings: [
    '__nosis_invoke("set_setting", { key: "theme", value: "dark" })',
    '__nosis_invoke("get_setting", { key: "theme" })',
  ],
  "API keys": [
    '__nosis_invoke("store_api_key", { provider: "anthropic", apiKey: "..." })',
    '__nosis_invoke("get_api_key", { provider: "anthropic" })',
  ],
  "Fal.ai image generation": [
    '__nosis_invoke("store_fal_api_key", { key: "your-fal-key" })',
    '__nosis_invoke("has_fal_api_key")',
    '__nosis_invoke("delete_fal_api_key")',
    '__nosis_invoke("generate_image", { prompt: "a cat in space" })',
    '__nosis_invoke("generate_image", { prompt: "sunset", model: "fal-ai/flux/dev", imageSize: "landscape_16_9" })',
    '__nosis_invoke("list_generations")',
  ],
  "MCP servers": [
    '__nosis_invoke("add_mcp_server", { name: "test", url: "https://example.com/mcp", authType: "none" })',
    '__nosis_invoke("list_mcp_servers")',
    '__nosis_invoke("delete_mcp_server", { id: "..." })',
  ],
  "Streaming (Anthropic + MCP tools)": [
    'const { promise, cancel } = __nosis_streamChat("conv-id", [{ role: "user", content: "Hello" }], "claude-sonnet-4-20250514")',
    "// call cancel() to abort",
  ],
};

function printDevHelp() {
  console.log("[nosis] DEV MODE — invoke exposed as window.__nosis_invoke()");
  for (const [section, commands] of Object.entries(DEV_COMMANDS)) {
    console.log(`[nosis] ${section}:`);
    for (const cmd of commands) {
      console.log(`  ${cmd}`);
    }
  }
}

function exposeDevGlobals() {
  window.__nosis_invoke = invoke;
  window.__nosis_streamChat = (
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
