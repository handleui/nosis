import { createAgent, type LettaProvider } from "@nosis/provider";
import type { CloudRuntimeAdapter } from "./contracts";

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

export interface ResolveOrCreateAgentFromAdapterInput {
  provider: LettaProvider;
  agentSeed: string;
  adapter: Pick<
    CloudRuntimeAdapter,
    | "getExistingAgentId"
    | "claimAgentId"
    | "getWinningAgentId"
    | "schedule"
    | "onError"
  >;
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

export async function resolveOrCreateAgentIdFromAdapter(
  input: ResolveOrCreateAgentFromAdapterInput
): Promise<string> {
  return await resolveOrCreateAgentId({
    provider: input.provider,
    agentSeed: input.agentSeed,
    getExistingAgentId: input.adapter.getExistingAgentId,
    claimAgentId: input.adapter.claimAgentId,
    getWinningAgentId: input.adapter.getWinningAgentId,
    schedule: input.adapter.schedule,
    onError: input.adapter.onError,
    errorContext: input.errorContext,
  });
}
