// Muppet — minimal frontend entry point
// Backend commands are exposed via Tauri IPC and can be tested from the console in dev mode.

import { invoke } from "@tauri-apps/api/core";

async function init() {
  // Only expose invoke globally in development builds for console testing.
  // In production this would allow any XSS payload to call Tauri commands.
  if (import.meta.env.DEV) {
    (window as any).__muppet_invoke = invoke;
    console.log("[muppet] DEV MODE — invoke exposed as window.__muppet_invoke()");
    console.log("[muppet] DB commands:");
    console.log('  __muppet_invoke("create_conversation", { title: "Test" })');
    console.log('  __muppet_invoke("list_conversations")');
    console.log('  __muppet_invoke("get_messages", { conversationId: "..." })');
    console.log(
      '  __muppet_invoke("save_message", { conversationId: "...", role: "user", content: "Hello" })',
    );
    console.log('  __muppet_invoke("delete_conversation", { id: "..." })');
    console.log(
      '  __muppet_invoke("update_conversation_title", { id: "...", title: "New title" })',
    );
  }
}

init();
