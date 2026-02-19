import {
  createMCPClient,
  auth,
  UnauthorizedError,
  type MCPClient,
} from "@ai-sdk/mcp";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ToolSet } from "ai";
import { createMuppetOAuthProvider } from "./mcp-oauth";

interface McpServer {
  id: string;
  name: string;
  url: string;
  auth_type: string;
}

interface OAuthCodePayload {
  code: string;
  state: string;
}

export interface McpToolsResult {
  tools: ToolSet;
  cleanup: () => Promise<void>;
}

function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes, matches Rust server timeout

function waitForOAuthCode(expectedState: string): {
  promise: Promise<string>;
  cancel: () => void;
} {
  let resolveOuter!: (code: string) => void;
  let rejectOuter!: (err: Error) => void;
  let cleanedUp = false;

  const result = new Promise<string>((res, rej) => {
    resolveOuter = res;
    rejectOuter = rej;
  });

  let unlistenCode: (() => void) | undefined;
  let unlistenError: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    unlistenCode?.();
    unlistenError?.();
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  };

  // Set up listeners asynchronously, but return synchronously
  Promise.all([
    listen<OAuthCodePayload>("mcp-oauth-code", (event) => {
      if (event.payload.state !== expectedState) {
        cleanup();
        rejectOuter(new Error("OAuth state mismatch — possible CSRF attempt"));
        return;
      }
      cleanup();
      resolveOuter(event.payload.code);
    }),
    listen<string>("mcp-oauth-error", (event) => {
      cleanup();
      rejectOuter(new Error(event.payload));
    }),
  ]).then(([codeUn, errorUn]) => {
    unlistenCode = codeUn;
    unlistenError = errorUn;
    // If already cancelled before listeners were set up, clean up now
    if (cleanedUp) {
      codeUn();
      errorUn();
    }
  });

  timeoutId = setTimeout(() => {
    cleanup();
    rejectOuter(new Error("OAuth flow timed out"));
  }, OAUTH_TIMEOUT_MS);

  return { promise: result, cancel: cleanup };
}

async function connectWithApiKey(server: McpServer): Promise<MCPClient> {
  const key = await invoke<string | null>("get_api_key", {
    provider: `mcp:${server.id}`,
  });
  if (!key) {
    throw new Error(`No API key found for MCP server "${server.name}"`);
  }
  return createMCPClient({
    transport: {
      type: "http",
      url: server.url,
      headers: { Authorization: `Bearer ${key}` },
    },
  });
}

async function connectWithOAuth(server: McpServer): Promise<MCPClient> {
  const authProvider = createMuppetOAuthProvider(server.id);

  // Try with cached tokens first — skip OAuth flow if still valid
  const cachedTokens = await authProvider.tokens();
  if (cachedTokens) {
    try {
      return await createMCPClient({
        transport: { type: "http", url: server.url, authProvider },
      });
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        throw err;
      }
      // Cached tokens expired/revoked — fall through to full OAuth flow
    }
  }

  // Start callback server only when OAuth is actually needed
  const oauthState = generateOAuthState();
  const port = await invoke<number>("start_oauth_callback_server", {
    expectedState: oauthState,
    serverId: server.id,
  });
  authProvider.updateRedirectUrl(`http://127.0.0.1:${port}/oauth/callback`);

  const { promise: codePromise, cancel: cancelCodeWait } =
    waitForOAuthCode(oauthState);

  try {
    const client = await createMCPClient({
      transport: { type: "http", url: server.url, authProvider },
    });
    // Connected without needing the OAuth callback — clean up listeners
    cancelCodeWait();
    return client;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      cancelCodeWait();
      throw err;
    }
  }

  const code = await codePromise;
  await auth(authProvider, {
    serverUrl: server.url,
    authorizationCode: code,
  });

  return createMCPClient({
    transport: { type: "http", url: server.url, authProvider },
  });
}

async function connectServer(server: McpServer): Promise<MCPClient> {
  switch (server.auth_type) {
    case "api_key":
      return connectWithApiKey(server);
    case "oauth":
      return connectWithOAuth(server);
    default:
      return createMCPClient({
        transport: { type: "http", url: server.url },
      });
  }
}

export async function getActiveTools(): Promise<McpToolsResult> {
  const servers = await invoke<McpServer[]>("list_mcp_servers");
  if (servers.length === 0) {
    return { tools: {}, cleanup: () => Promise.resolve() };
  }

  const clients: MCPClient[] = [];
  const tools: ToolSet = {};

  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const client = await connectServer(server);
      clients.push(client);
      return client.tools();
    })
  );

  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      Object.assign(tools, result.value);
    } else {
      console.warn(`Failed to connect to MCP server "${servers[i].name}"`);
    }
  }

  return {
    tools,
    cleanup: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
