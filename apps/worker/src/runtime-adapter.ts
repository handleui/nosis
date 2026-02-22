import type { CloudRuntimeAdapter } from "@nosis/agent-runtime/contracts";
import type { CloudExecutionTarget } from "@nosis/agent-runtime/execution";
import type { ToolSet } from "ai";
import {
  type AppDatabase,
  type ConversationRuntime,
  getConversationRuntime,
  saveMessageBatch,
  trySetConversationAgentId,
} from "./db";
import { getActiveTools } from "./mcp";
import { sanitizeError } from "./sanitize";
import type { Bindings } from "./types";

interface WorkerRuntimeAdapterInput {
  db: AppDatabase;
  env: Bindings;
  ctx: ExecutionContext;
  userId: string;
  conversationId: string;
  initialRuntime: ConversationRuntime;
  lettaApiKey: string;
}

export interface WorkerRuntimeAdapter extends CloudRuntimeAdapter {
  loadTools: (
    executionTarget: CloudExecutionTarget
  ) => Promise<{ tools: ToolSet; cleanup: () => Promise<void> }>;
}

export function createWorkerRuntimeAdapter(
  input: WorkerRuntimeAdapterInput
): WorkerRuntimeAdapter {
  let runtime = input.initialRuntime;

  return {
    getExistingAgentId: async () => runtime.letta_agent_id,
    claimAgentId: async (agentId: string) => {
      const claimed = await trySetConversationAgentId(
        input.db,
        input.conversationId,
        input.userId,
        agentId
      );
      if (claimed) {
        runtime = {
          ...runtime,
          letta_agent_id: agentId,
        };
      }
      return claimed;
    },
    getWinningAgentId: async () => {
      const latest = await getConversationRuntime(
        input.db,
        input.conversationId,
        input.userId
      );
      runtime = latest;
      return latest.letta_agent_id;
    },
    saveUserMessage: async (content: string) => {
      await saveMessageBatch(
        input.db,
        crypto.randomUUID(),
        input.conversationId,
        "user",
        content,
        null,
        0,
        0
      );
    },
    saveAssistantMessage: async (content: string) => {
      await saveMessageBatch(
        input.db,
        crypto.randomUUID(),
        input.conversationId,
        "assistant",
        content,
        null,
        0,
        0
      );
    },
    loadTools: async (executionTarget: CloudExecutionTarget) => {
      return await getActiveTools(
        input.db,
        input.env,
        input.userId,
        runtime.office_id,
        executionTarget
      );
    },
    schedule: (task: Promise<void>) => {
      input.ctx.waitUntil(task);
    },
    onError: (message: string, error: unknown) => {
      console.error(
        message,
        sanitizeError(error, [input.lettaApiKey, input.env.BETTER_AUTH_SECRET])
      );
    },
  };
}
