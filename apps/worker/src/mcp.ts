import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { decryptApiKey } from "./crypto";
import { type AppDatabase, listMcpServers } from "./db";
import { userApiKeys } from "./schema";
import type {
  Bindings,
  ConversationExecutionTarget,
  McpServer,
  McpServerScope,
} from "./types";

const ARCADE_GATEWAY_URL = "https://api.arcade.dev/mcp/nosis";

export interface McpToolsResult {
  tools: ToolSet;
  cleanup: () => Promise<void>;
}

function scopesForExecutionTarget(
  _executionTarget: ConversationExecutionTarget
): readonly McpServerScope[] {
  return ["global", "sandbox"];
}

/** Batch-fetch all encrypted API keys for the given MCP server IDs in one query. */
async function fetchServerKeys(
  db: AppDatabase,
  officeId: string,
  serverIds: string[]
): Promise<Map<string, string>> {
  if (serverIds.length === 0) {
    return new Map();
  }

  const providers = serverIds.map((id) => `mcp:${id}`);
  const rows = await db
    .select({
      provider: userApiKeys.provider,
      encrypted_key: userApiKeys.encrypted_key,
    })
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.user_id, officeId),
        inArray(userApiKeys.provider, providers)
      )
    );

  const keyMap = new Map<string, string>();
  for (const row of rows) {
    // provider is "mcp:<server-id>" — extract the server ID
    const serverId = row.provider.slice(4);
    keyMap.set(serverId, row.encrypted_key);
  }
  return keyMap;
}

async function connectUserServer(
  env: Bindings,
  officeId: string,
  server: McpServer,
  encryptedKey: string | undefined
): Promise<MCPClient> {
  const headers: Record<string, string> = {};

  if (server.auth_type === "api_key" && encryptedKey) {
    const apiKey = await decryptApiKey(
      env.BETTER_AUTH_SECRET,
      officeId,
      encryptedKey
    );
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return createMCPClient({
    transport: {
      type: "http",
      url: server.url,
      headers,
    },
  });
}

export async function getActiveTools(
  db: AppDatabase,
  env: Bindings,
  userId: string,
  officeId: string,
  executionTarget: ConversationExecutionTarget
): Promise<McpToolsResult> {
  const clients: MCPClient[] = [];
  const tools: ToolSet = {};

  // Fetch user servers + batch-load their API keys (1 query instead of N)
  const scopes = scopesForExecutionTarget(executionTarget);
  const servers = await listMcpServers(db, userId, scopes);
  const authServerIds = servers
    .filter((s) => s.auth_type === "api_key")
    .map((s) => s.id);
  const keyMap = await fetchServerKeys(db, officeId, authServerIds);

  // Connect to Arcade and all user servers in parallel
  const connectionTasks: Promise<{ client: MCPClient; tools: ToolSet }>[] = [];

  if (env.ARCADE_API_KEY) {
    connectionTasks.push(
      createMCPClient({
        transport: {
          type: "http",
          url: ARCADE_GATEWAY_URL,
          headers: {
            Authorization: `Bearer ${env.ARCADE_API_KEY}`,
            "Arcade-User-ID": userId,
          },
        },
      }).then(async (client) => ({ client, tools: await client.tools() }))
    );
  }

  for (const server of servers) {
    const encryptedKey = keyMap.get(server.id);
    if (server.auth_type === "api_key" && !encryptedKey) {
      continue;
    }
    connectionTasks.push(
      connectUserServer(env, officeId, server, encryptedKey).then(
        async (client) => ({ client, tools: await client.tools() })
      )
    );
  }

  const results = await Promise.allSettled(connectionTasks);

  for (const result of results) {
    if (result.status === "fulfilled") {
      clients.push(result.value.client);
      Object.assign(tools, result.value.tools);
    } else {
      console.error(
        "Failed to connect MCP server:",
        result.reason instanceof Error ? result.reason.message : "Unknown error"
      );
    }
  }

  return {
    tools,
    cleanup: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
