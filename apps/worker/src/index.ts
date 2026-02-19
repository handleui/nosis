import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { streamChat } from "./chat";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getMessages,
  listConversations,
  saveMessage,
  setConversationAgentId,
  updateConversationTitle,
} from "./db";
import { searchExa, validateSearchRequest } from "./exa";
import { scrapeUrl, validateScrapeRequest } from "./firecrawl";
import { redactSecrets, sanitizeError } from "./sanitize";
import {
  parseJsonBody,
  validateAgentId,
  validateContent,
  validateModel,
  validatePagination,
  validateRole,
  validateTitle,
  validateTokenCount,
  validateUuid,
} from "./validate";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGE_BYTES = 512 * 1024;

interface Bindings {
  ENVIRONMENT?: string;
  EXA_API_KEY: string;
  FIRECRAWL_API_KEY: string;
  LETTA_API_KEY: string;
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>();

app.use(secureHeaders());

app.use(
  cors({
    origin: (origin, c) => {
      const allowed = ["tauri://localhost"];
      if (c.env.ENVIRONMENT !== "production") {
        allowed.push("http://localhost:1420");
      }
      return allowed.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
    credentials: false,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

// Reject non-JSON content types on mutation requests (CSRF defense)
app.use(async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    const ct = c.req.header("content-type") ?? "";
    if (!ct.startsWith("application/json")) {
      throw new HTTPException(415, {
        message: "Content-Type must be application/json",
      });
    }
  }
  await next();
});

// ── Exa Search ──

app.post(
  "/api/search",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const body = await parseJsonBody(c);
    const request = validateSearchRequest(body);
    const results = await searchExa(c.env.EXA_API_KEY, request);
    return c.json(results);
  }
);

// ── Firecrawl Extract ──

app.post(
  "/api/extract",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const body = await parseJsonBody(c);
    const request = validateScrapeRequest(body);
    const result = await scrapeUrl(c.env.FIRECRAWL_API_KEY, request);
    return c.json(result);
  }
);

// ── Conversations ──

app.post(
  "/api/conversations",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const body = await parseJsonBody(c);
    const title =
      body.title !== undefined ? validateTitle(body.title) : "New Conversation";
    const id = crypto.randomUUID();
    const conversation = await createConversation(c.env.DB, id, title);
    return c.json(conversation, 201);
  }
);

app.get("/api/conversations", async (c) => {
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const conversations = await listConversations(c.env.DB, limit, offset);
  return c.json(conversations);
});

app.get("/api/conversations/:id", async (c) => {
  const id = validateUuid(c.req.param("id"));
  const conversation = await getConversation(c.env.DB, id);
  return c.json(conversation);
});

app.patch(
  "/api/conversations/:id/title",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const id = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const title = validateTitle(body.title);
    await updateConversationTitle(c.env.DB, id, title);
    return c.json({ ok: true });
  }
);

app.delete("/api/conversations/:id", async (c) => {
  const id = validateUuid(c.req.param("id"));
  await deleteConversation(c.env.DB, id);
  return c.json({ ok: true });
});

app.patch(
  "/api/conversations/:id/agent",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const id = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const agentId = validateAgentId(body.agent_id);
    await setConversationAgentId(c.env.DB, id, agentId);
    return c.json({ ok: true });
  }
);

// ── Messages ──

app.get("/api/conversations/:id/messages", async (c) => {
  const conversationId = validateUuid(c.req.param("id"));
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const messages = await getMessages(c.env.DB, conversationId, limit, offset);
  return c.json(messages);
});

app.post(
  "/api/conversations/:id/messages",
  bodyLimit({ maxSize: MAX_MESSAGE_BYTES }),
  async (c) => {
    const conversationId = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const role = validateRole(body.role);
    const content = validateContent(body.content);
    const model = validateModel(body.model) ?? null;
    const tokensIn = validateTokenCount(body.tokens_in, "tokens_in") ?? 0;
    const tokensOut = validateTokenCount(body.tokens_out, "tokens_out") ?? 0;

    const id = crypto.randomUUID();
    const message = await saveMessage(
      c.env.DB,
      id,
      conversationId,
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
    const conversationId = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const content = validateContent(body.content);
    return streamChat(
      c.env.DB,
      c.env.LETTA_API_KEY,
      conversationId,
      content,
      c.executionCtx
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
  ] as const;

  if (err instanceof HTTPException) {
    return c.json({ error: redactSecrets(err.message, secrets) }, err.status);
  }

  console.error("Unhandled error:", sanitizeError(err, secrets));
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
