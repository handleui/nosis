import { streamText, type ToolSet } from "ai";
import {
  SANDBOX_EXECUTION_TARGET,
  type SandboxExecutionTarget,
} from "./execution";
import type {
  AgentIdRegistry,
  MessagePersistence,
  RuntimeErrorReporter,
  RuntimeScheduler,
  RuntimeTools,
  ToolLoader,
} from "./contracts";
import {
  createAgent,
  createProvider,
  type LettaProvider,
} from "@nosis/provider";

export interface AgentTools extends RuntimeTools {
  tools: ToolSet;
}

export interface AgentPersistence extends AgentIdRegistry, MessagePersistence {}

export interface AgentRuntimeHooks
  extends RuntimeScheduler,
    RuntimeErrorReporter,
    Omit<ToolLoader, "loadTools"> {
  loadTools: (executionTarget: SandboxExecutionTarget) => Promise<AgentTools>;
}

export interface StreamAgentChatInput {
  apiKey: string;
  agentSeed: string;
  content: string;
  persistence: AgentPersistence;
  hooks: AgentRuntimeHooks;
  errorContext?: string;
}

function formatErrorContext(
  message: string,
  errorContext: string | undefined
): string {
  if (!errorContext) {
    return message;
  }
  return `${message} [${errorContext}]`;
}

export interface ResolveOrCreateAgentIdInput {
  provider: LettaProvider;
  agentSeed: string;
  getExistingAgentId: () => Promise<string | null>;
  claimAgentId: (agentId: string) => Promise<boolean>;
  getWinningAgentId: () => Promise<string | null>;
  schedule: (task: Promise<void>) => void;
  onError: (message: string, error: unknown) => void;
  errorContext?: string;
}

export async function resolveOrCreateAgentId(
  input: ResolveOrCreateAgentIdInput
): Promise<string> {
  const existing = await input.getExistingAgentId();
  if (existing) {
    return existing;
  }

  const newAgentId = await createAgent(input.provider, input.agentSeed);
  const claimed = await input.claimAgentId(newAgentId);
  if (claimed) {
    return newAgentId;
  }

  input.schedule(
    input.provider.client.agents
      .delete(newAgentId)
      .then(() => undefined)
      .catch((error: unknown) => {
        input.onError(
          formatErrorContext(
            "Failed to delete orphan agent",
            input.errorContext
          ),
          error
        );
      })
  );

  const winner = await input.getWinningAgentId();
  if (!winner) {
    throw new Error("Failed to resolve agent for conversation");
  }

  return winner;
}

export async function streamAgentChat(
  input: StreamAgentChatInput
): Promise<Response> {
  const provider = createProvider(input.apiKey);
  const agentId = await resolveOrCreateAgentId({
    provider,
    agentSeed: input.agentSeed,
    getExistingAgentId: input.persistence.getExistingAgentId,
    claimAgentId: input.persistence.claimAgentId,
    getWinningAgentId: input.persistence.getWinningAgentId,
    schedule: input.hooks.schedule,
    onError: input.hooks.onError,
    errorContext: input.errorContext,
  });

  const [, loadedTools] = await Promise.all([
    input.persistence.saveUserMessage(input.content),
    input.hooks.loadTools(SANDBOX_EXECUTION_TARGET),
  ]);

  const hasTools = Object.keys(loadedTools.tools).length > 0;
  const result = streamText({
    model: provider(),
    providerOptions: {
      letta: {
        agent: { id: agentId, streamTokens: true },
        timeoutInSeconds: 300,
      },
    },
    prompt: input.content,
    ...(hasTools && { tools: loadedTools.tools }),
    onError({ error }) {
      input.hooks.onError(
        formatErrorContext("streamText error", input.errorContext),
        error
      );
    },
  });

  input.hooks.schedule(
    (async () => {
      try {
        const text = await result.text;
        if (text.trim().length > 0) {
          await input.persistence.saveAssistantMessage(text);
        }
      } catch (error: unknown) {
        input.hooks.onError(
          formatErrorContext(
            "Failed to save assistant message",
            input.errorContext
          ),
          error
        );
      } finally {
        await loadedTools.cleanup().catch(() => undefined);
      }
    })()
  );

  return result.toUIMessageStreamResponse({
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}
