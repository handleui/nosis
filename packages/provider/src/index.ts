import { createLetta } from "@letta-ai/vercel-ai-sdk-provider";
import type { LettaProvider } from "@letta-ai/vercel-ai-sdk-provider";

export type { LettaProvider } from "@letta-ai/vercel-ai-sdk-provider";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_PERSONA =
  "I am Nosis, a helpful AI assistant. I remember our conversations and learn your preferences over time.";
export const DEFAULT_HUMAN = "The user has not shared personal details yet.";

export function createProvider(apiKey: string): LettaProvider {
  return createLetta({ token: apiKey });
}

export async function createAgent(
  provider: LettaProvider,
  conversationId: string
): Promise<string> {
  const agent = await provider.client.agents.create({
    name: `nosis-${conversationId.slice(0, 8)}`,
    model: DEFAULT_MODEL,
    contextWindowLimit: DEFAULT_CONTEXT_WINDOW,
    memoryBlocks: [
      { label: "persona", value: DEFAULT_PERSONA, limit: 5000 },
      { label: "human", value: DEFAULT_HUMAN, limit: 5000 },
    ],
  });
  return agent.id;
}
