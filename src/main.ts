import { invoke } from "@tauri-apps/api/core";
import { streamChat } from "./streaming";

declare global {
  interface Window {
    __muppet_invoke: typeof invoke;
    __muppet_streamChat: (
      conversationId: string,
      prompt: string
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
    '__muppet_invoke("store_api_key", { provider: "letta", apiKey: "..." })',
    '__muppet_invoke("get_api_key", { provider: "letta" })',
  ],
  "Exa search": [
    '__muppet_invoke("store_exa_api_key", { key: "exa-..." })',
    '__muppet_invoke("search_web", { query: "latest AI news", numResults: 5 })',
    '__muppet_invoke("has_exa_api_key")',
  ],
  "Streaming (Letta)": [
    'const { promise, cancel } = __muppet_streamChat("conv-id", "Hello")',
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
  window.__muppet_streamChat = (conversationId: string, prompt: string) =>
    streamChat(conversationId, prompt, {
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
