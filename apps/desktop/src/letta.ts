import {
  createLetta,
  type LettaProvider,
} from "@letta-ai/vercel-ai-sdk-provider";
import { invoke } from "@tauri-apps/api/core";

const LETTA_PROVIDER = "letta";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_PERSONA =
  "I am Muppet, a helpful AI assistant. I remember our conversations and learn your preferences over time.";
const DEFAULT_HUMAN = "The user has not shared personal details yet.";

export async function getLettaApiKey(): Promise<string> {
  const apiKey = await invoke<string | null>("get_api_key", {
    provider: LETTA_PROVIDER,
  });
  if (!apiKey) {
    throw new Error(
      "Letta API key not configured. Use store_api_key with provider 'letta' to set it."
    );
  }
  return apiKey;
}

export function createLettaProvider(apiKey: string): LettaProvider {
  return createLetta({ token: apiKey });
}

export async function createAgentForConversation(
  provider: LettaProvider,
  conversationId: string
): Promise<string> {
  const agent = await provider.client.agents.create({
    name: `muppet-${conversationId.slice(0, 8)}`,
    model: DEFAULT_MODEL,
    contextWindowLimit: DEFAULT_CONTEXT_WINDOW,
    memoryBlocks: [
      { label: "persona", value: DEFAULT_PERSONA, limit: 5000 },
      { label: "human", value: DEFAULT_HUMAN, limit: 5000 },
    ],
  });

  try {
    await invoke("set_conversation_agent_id", {
      conversationId,
      agentId: agent.id,
    });
  } catch (err) {
    // Best-effort cleanup to avoid orphaned remote agents
    await provider.client.agents.delete(agent.id).catch(() => undefined);
    throw err;
  }

  return agent.id;
}
