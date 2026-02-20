import { invoke } from "@tauri-apps/api/core";
import {
  setAuthToken,
  ApiError,
  createConversation,
  listConversations,
  getConversation,
  updateConversationTitle,
  deleteConversation,
  setConversationAgentId,
  getMessages,
  saveMessage,
} from "./api";

// getAuthToken is intentionally excluded: exposing it in the console object
// would let an XSS payload exfiltrate the in-memory Bearer token.
const nosisApi = {
  setAuthToken,
  ApiError,
  createConversation,
  listConversations,
  getConversation,
  updateConversationTitle,
  deleteConversation,
  setConversationAgentId,
  getMessages,
  saveMessage,
};

declare global {
  interface Window {
    __nosis_invoke: typeof invoke;
    __nosis_api: typeof nosisApi;
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
  "Worker API (conversations)": [
    '__nosis_api.createConversation("Test")',
    "__nosis_api.listConversations()",
    '__nosis_api.getConversation("...")',
    '__nosis_api.updateConversationTitle("...", "New title")',
    '__nosis_api.deleteConversation("...")',
  ],
  "Worker API (messages)": [
    '__nosis_api.getMessages("...")',
    '__nosis_api.saveMessage("...", "user", "Hello")',
  ],
  "Tauri (secrets)": [
    '__nosis_invoke("store_api_key", { provider: "anthropic", apiKey: "..." })',
    '__nosis_invoke("get_api_key", { provider: "anthropic" })',
  ],
  "Tauri (MCP servers)": [
    '__nosis_invoke("add_mcp_server", { name: "test", url: "https://example.com/mcp", authType: "none" })',
    '__nosis_invoke("list_mcp_servers")',
    '__nosis_invoke("delete_mcp_server", { id: "..." })',
  ],
};

function printDevHelp() {
  console.log(
    "[nosis] DEV MODE — api exposed as window.__nosis_api, invoke as window.__nosis_invoke"
  );
  for (const [section, commands] of Object.entries(DEV_COMMANDS)) {
    console.log(`[nosis] ${section}:`);
    for (const cmd of commands) {
      console.log(`  ${cmd}`);
    }
  }
}

function exposeDevGlobals() {
  window.__nosis_invoke = invoke;
  window.__nosis_api = nosisApi;
}

setupEscapeDismiss();

// Only expose globals in dev builds — in production this would be an XSS vector.
if (import.meta.env.DEV) {
  exposeDevGlobals();
  printDevHelp();
}
