import { drizzle } from "drizzle-orm/d1";
import { getMigrations } from "better-auth/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { authorizeTool, checkAuthStatus, listTools } from "./arcade";
import { createAuth } from "./auth";
import { streamChat } from "./chat";
import { encryptApiKey } from "./crypto";
import {
  type AppDatabase,
  addMcpServer,
  createConversation,
  deleteConversation,
  deleteMcpServer,
  deleteUserApiKey,
  getConversation,
  getMessages,
  listConversations,
  listMcpServers,
  listUserApiKeys,
  saveMessage,
  setConversationAgentId,
  updateConversationTitle,
  upsertUserApiKey,
} from "./db";
import { searchExa, validateSearchRequest } from "./exa";
import { scrapeUrl, validateScrapeRequest } from "./firecrawl";
import { resolveUserApiKey } from "./keys";
import {
  type AuthVariables,
  getUserId,
  requireAuth,
  sessionMiddleware,
} from "./middleware";
import { redactSecrets, sanitizeError } from "./sanitize";
// biome-ignore lint/performance/noNamespaceImport: Drizzle requires schema as namespace object
import * as schema from "./schema";
import type { Bindings } from "./types";
import {
  parseJsonBody,
  validateAgentId,
  validateApiKeyInput,
  validateContent,
  validateMcpAuthType,
  validateMcpName,
  validateMcpUrl,
  validateModel,
  validatePagination,
  validateProvider,
  validateRole,
  validateTitle,
  validateTokenCount,
  validateUuid,
} from "./validate";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGE_BYTES = 512 * 1024;

function db(env: Bindings): AppDatabase {
  return drizzle(env.DB, { schema });
}

const app = new Hono<{
  Bindings: Bindings;
  Variables: AuthVariables;
}>();

app.use(secureHeaders());

app.use(
  cors({
    origin: (origin, c) => {
      if (origin === "tauri://localhost") {
        return origin;
      }
      if (
        c.env.ENVIRONMENT === "development" &&
        (origin === "http://localhost:1420" ||
          origin === "http://localhost:3000")
      ) {
        return origin;
      }
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

// ── Better Auth (handles its own routes, must precede content-type guard) ──

app.on(
  ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  "/api/auth/*",
  (c) => {
    const auth = createAuth(c.env);
    return auth.handler(c.req.raw);
  }
);

// ── Dev-only migration endpoint (must precede content-type guard) ──

app.get("/migrate", async (c) => {
  if (c.env.ENVIRONMENT !== "development") {
    return c.json({ error: "Not found" }, 404);
  }
  const auth = createAuth(c.env);
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
    auth.options
  );
  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    return c.json({ message: "No migrations needed" });
  }
  await runMigrations();
  return c.json({
    created: toBeCreated.map((t: { table: string }) => t.table),
    added: toBeAdded.map((t: { table: string }) => t.table),
  });
});

// Reject non-JSON content types on mutation requests (CSRF defense)
app.use(async (c, next) => {
  const method = c.req.method;
  const isMutation =
    method === "POST" || method === "PATCH" || method === "PUT";
  if (isMutation) {
    const ct = c.req.header("content-type") ?? "";
    if (!ct.startsWith("application/json")) {
      throw new HTTPException(415, {
        message: "Content-Type must be application/json",
      });
    }
  }
  await next();
});

// ── Auth middleware (resolve session, require auth for /api/*) ──

app.use("/api/*", sessionMiddleware);
app.use("/api/*", requireAuth);

// ── User API Keys (BYOK) ──

app.put(
  "/api/keys/:provider",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const provider = validateProvider(c.req.param("provider"));
    const body = await parseJsonBody(c);
    const apiKey = validateApiKeyInput(body.apiKey);

    const encrypted = await encryptApiKey(
      c.env.BETTER_AUTH_SECRET,
      userId,
      apiKey
    );

    await upsertUserApiKey(db(c.env), userId, provider, encrypted);
    return c.json({ ok: true });
  }
);

app.get("/api/keys", async (c) => {
  const userId = getUserId(c);
  const rows = await listUserApiKeys(db(c.env), userId);
  return c.json(rows);
});

app.delete("/api/keys/:provider", async (c) => {
  const userId = getUserId(c);
  const provider = validateProvider(c.req.param("provider"));
  await deleteUserApiKey(db(c.env), userId, provider);
  return c.json({ ok: true });
});

// ── Exa Search ──

app.post(
  "/api/search",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const request = validateSearchRequest(body);
    const apiKey = await resolveUserApiKey(
      db(c.env),
      c.env.BETTER_AUTH_SECRET,
      userId,
      "exa"
    );
    const results = await searchExa(apiKey, request);
    return c.json(results);
  }
);

// ── Firecrawl Extract ──

app.post(
  "/api/extract",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const request = validateScrapeRequest(body);
    const apiKey = await resolveUserApiKey(
      db(c.env),
      c.env.BETTER_AUTH_SECRET,
      userId,
      "firecrawl"
    );
    const result = await scrapeUrl(apiKey, request);
    return c.json(result);
  }
);

// ── MCP Servers ──

app.post(
  "/api/mcp/servers",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const name = validateMcpName(body.name);
    const url = validateMcpUrl(body.url);
    const authType = validateMcpAuthType(body.auth_type ?? "none");

    const id = crypto.randomUUID();

    // If api_key auth, encrypt and store the key
    if (authType === "api_key") {
      const apiKey = validateApiKeyInput(body.api_key);
      const encrypted = await encryptApiKey(
        c.env.BETTER_AUTH_SECRET,
        userId,
        apiKey
      );
      await upsertUserApiKey(db(c.env), userId, `mcp:${id}`, encrypted);
    }

    const server = await addMcpServer(
      db(c.env),
      id,
      userId,
      name,
      url,
      authType
    );
    return c.json(server, 201);
  }
);

app.get("/api/mcp/servers", async (c) => {
  const userId = getUserId(c);
  const servers = await listMcpServers(db(c.env), userId);
  return c.json(servers);
});

app.delete("/api/mcp/servers/:id", async (c) => {
  const userId = getUserId(c);
  const id = validateUuid(c.req.param("id"));
  const deleted = await deleteMcpServer(db(c.env), id, userId);

  if (!deleted) {
    throw new HTTPException(404, { message: "MCP server not found" });
  }

  // Fire-and-forget cleanup of associated encrypted key (don't block response)
  c.executionCtx.waitUntil(
    deleteUserApiKey(db(c.env), userId, `mcp:${id}`).catch(() => undefined)
  );

  return c.json({ ok: true });
});

// ── Arcade Management ──

app.get("/api/arcade/tools", async (c) => {
  const userId = getUserId(c);
  const arcadeKey = c.env.ARCADE_API_KEY;
  if (!arcadeKey) {
    throw new HTTPException(404, { message: "Arcade not configured" });
  }

  const toolkit = c.req.query("toolkit");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Number(limitStr) : undefined;
  if (limit !== undefined && Number.isNaN(limit)) {
    throw new HTTPException(400, { message: "Invalid limit" });
  }

  const result = await listTools(arcadeKey, userId, toolkit, limit);
  return c.json(result);
});

app.post(
  "/api/arcade/tools/:name/authorize",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const arcadeKey = c.env.ARCADE_API_KEY;
    if (!arcadeKey) {
      throw new HTTPException(404, { message: "Arcade not configured" });
    }

    const toolName = c.req.param("name");
    const result = await authorizeTool(arcadeKey, userId, toolName);
    return c.json(result);
  }
);

app.get("/api/arcade/auth/:id/status", async (c) => {
  const arcadeKey = c.env.ARCADE_API_KEY;
  if (!arcadeKey) {
    throw new HTTPException(404, { message: "Arcade not configured" });
  }

  const authorizationId = c.req.param("id");
  const waitStr = c.req.query("wait");
  const wait = waitStr ? Number(waitStr) : undefined;
  if (wait !== undefined && Number.isNaN(wait)) {
    throw new HTTPException(400, { message: "Invalid wait" });
  }

  const result = await checkAuthStatus(arcadeKey, authorizationId, wait);
  return c.json(result);
});

// ── Conversations ──

app.post(
  "/api/conversations",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const title =
      body.title !== undefined ? validateTitle(body.title) : "New Conversation";
    const id = crypto.randomUUID();
    const conversation = await createConversation(db(c.env), id, userId, title);
    return c.json(conversation, 201);
  }
);

app.get("/api/conversations", async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const conversations = await listConversations(
    db(c.env),
    userId,
    limit,
    offset
  );
  return c.json(conversations);
});

app.get("/api/conversations/:id", async (c) => {
  const userId = getUserId(c);
  const id = validateUuid(c.req.param("id"));
  const conversation = await getConversation(db(c.env), id, userId);
  return c.json(conversation);
});

app.patch(
  "/api/conversations/:id/title",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const id = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const title = validateTitle(body.title);
    await updateConversationTitle(db(c.env), id, userId, title);
    return c.json({ ok: true });
  }
);

app.delete("/api/conversations/:id", async (c) => {
  const userId = getUserId(c);
  const id = validateUuid(c.req.param("id"));
  await deleteConversation(db(c.env), id, userId);
  return c.json({ ok: true });
});

app.patch(
  "/api/conversations/:id/agent",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const id = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const agentId = validateAgentId(body.agent_id);
    await setConversationAgentId(db(c.env), id, userId, agentId);
    return c.json({ ok: true });
  }
);

// ── Messages ──

app.get("/api/conversations/:id/messages", async (c) => {
  const userId = getUserId(c);
  const conversationId = validateUuid(c.req.param("id"));
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const messages = await getMessages(
    db(c.env),
    conversationId,
    userId,
    limit,
    offset
  );
  return c.json(messages);
});

app.post(
  "/api/conversations/:id/messages",
  bodyLimit({ maxSize: MAX_MESSAGE_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const conversationId = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const role = validateRole(body.role);
    const content = validateContent(body.content);
    const model = validateModel(body.model) ?? null;
    const tokensIn = validateTokenCount(body.tokens_in, "tokens_in") ?? 0;
    const tokensOut = validateTokenCount(body.tokens_out, "tokens_out") ?? 0;

    const id = crypto.randomUUID();
    const message = await saveMessage(
      db(c.env),
      id,
      conversationId,
      userId,
      role,
      content,
      model,
      tokensIn,
      tokensOut
    );
    return c.json(message, 201);
  }
);

// ── Chat (AI Streaming) ──

app.post(
  "/api/conversations/:id/chat",
  bodyLimit({ maxSize: MAX_MESSAGE_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const conversationId = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const content = validateContent(body.content);
    const d = db(c.env);
    const lettaApiKey = await resolveUserApiKey(
      d,
      c.env.BETTER_AUTH_SECRET,
      userId,
      "letta"
    );
    return streamChat(
      d,
      lettaApiKey,
      conversationId,
      userId,
      content,
      c.executionCtx,
      c.env
    );
  }
);

// ── Not-Found & Error Handlers ──

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  const secrets = [
    c.env.LETTA_API_KEY,
    c.env.EXA_API_KEY,
    c.env.FIRECRAWL_API_KEY,
    c.env.ARCADE_API_KEY,
    c.env.BETTER_AUTH_SECRET,
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
  ].filter((s): s is string => Boolean(s));

  if (err instanceof HTTPException) {
    return c.json({ error: redactSecrets(err.message, secrets) }, err.status);
  }

  console.error("Unhandled error:", sanitizeError(err, secrets));
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
