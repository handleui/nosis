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
import { normalizeChatRequest } from "./chat-request";
import { encryptApiKey } from "./crypto";
import {
  type AppDatabase,
  addMcpServer,
  createOffice,
  createConversation,
  createProject,
  createWorkspace,
  deleteConversation,
  deleteMcpServer,
  deleteUserApiKey,
  getConversation,
  getDefaultOffice,
  getOffice,
  getProject,
  getProjectByRepoUrl,
  getWorkspace,
  getMessages,
  listConversations,
  listOffices,
  listMcpServers,
  listProjects,
  listUserApiKeys,
  listWorkspaces,
  saveMessage,
  setConversationAgentId,
  setConversationExecutionTarget,
  setConversationWorkspace,
  updateConversationTitle,
  upsertUserApiKey,
} from "./db";
import { searchExa, validateSearchRequest } from "./exa";
import { scrapeUrl, validateScrapeRequest } from "./firecrawl";
import {
  createBranch,
  createPullRequest,
  getCheckRuns,
  getPullRequest,
  listBranches,
  listPullRequests,
  listUserRepos,
} from "./github";
import { resolveOfficeApiKey } from "./keys";
import {
  type AuthVariables,
  getGithubToken,
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
  canonicalizeGithubRepoUrl,
  validateAgentId,
  validateApiKeyInput,
  validateBranchName,
  validateContent,
  validateMcpAuthType,
  validateMcpName,
  validateMcpScope,
  validateMcpUrl,
  validateModel,
  validateOfficeName,
  validateOptionalPath,
  validateOptionalText,
  validateOwner,
  validatePagination,
  validateProvider,
  validatePullNumber,
  validateRepoName,
  validateRole,
  validateNullableUuid,
  validateWorkspaceKind,
  validateWorkspaceName,
  validateWorkspaceStatus,
  validateTitle,
  validateTokenCount,
  validateExecutionTarget,
  validateUuid,
} from "./validate";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGE_BYTES = 512 * 1024;
const DEFAULT_BRANCH_FALLBACK = "main";

function toWorkspaceBranchName(workspaceId: string): string {
  return `nosis/${workspaceId}`;
}

function db(env: Bindings): AppDatabase {
  return drizzle(env.DB, { schema });
}

async function resolveOfficeId(
  appDb: AppDatabase,
  userId: string,
  officeIdInput: unknown
): Promise<string> {
  if (
    officeIdInput === undefined ||
    officeIdInput === null ||
    officeIdInput === ""
  ) {
    const office = await getDefaultOffice(appDb, userId);
    return office.id;
  }

  const officeId = validateUuid(officeIdInput, "office_id");
  const office = await getOffice(appDb, officeId, userId);
  return office.id;
}

async function resolveOptionalOfficeId(
  appDb: AppDatabase,
  userId: string,
  officeIdInput: unknown
): Promise<string | undefined> {
  if (
    officeIdInput === undefined ||
    officeIdInput === null ||
    officeIdInput === ""
  ) {
    return undefined;
  }
  return await resolveOfficeId(appDb, userId, officeIdInput);
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
          origin === "http://localhost:3000" ||
          origin === "http://nosis-web.localhost:1355")
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

// ── Auth middleware (resolve session, require auth for /api/*) ──

app.use("/api/*", sessionMiddleware);
app.use("/api/*", requireAuth);

// ── Offices ──

app.post(
  "/api/offices",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const name = validateOfficeName(body.name);
    const office = await createOffice(db(c.env), {
      id: crypto.randomUUID(),
      userId,
      name,
    });
    return c.json(office, 201);
  }
);

app.get("/api/offices", async (c) => {
  const userId = getUserId(c);
  const offices = await listOffices(db(c.env), userId);
  return c.json(offices);
});

// ── User API Keys (BYOK) ──

app.put(
  "/api/keys/:provider",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const appDb = db(c.env);
    const userId = getUserId(c);
    const provider = validateProvider(c.req.param("provider"));
    const body = await parseJsonBody(c);
    const apiKey = validateApiKeyInput(body.apiKey);
    const officeId = await resolveOfficeId(appDb, userId, body.office_id);

    const encrypted = await encryptApiKey(
      c.env.BETTER_AUTH_SECRET,
      officeId,
      apiKey
    );

    await upsertUserApiKey(appDb, officeId, userId, provider, encrypted);
    return c.json({ ok: true });
  }
);

app.get("/api/keys", async (c) => {
  const appDb = db(c.env);
  const userId = getUserId(c);
  const officeId = await resolveOfficeId(
    appDb,
    userId,
    c.req.query("office_id")
  );
  const rows = await listUserApiKeys(appDb, officeId, userId);
  return c.json(rows);
});

app.delete("/api/keys/:provider", async (c) => {
  const appDb = db(c.env);
  const userId = getUserId(c);
  const provider = validateProvider(c.req.param("provider"));
  const officeId = await resolveOfficeId(
    appDb,
    userId,
    c.req.query("office_id")
  );
  await deleteUserApiKey(appDb, officeId, userId, provider);
  return c.json({ ok: true });
});

// ── Exa Search ──

app.post(
  "/api/search",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const appDb = db(c.env);
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const request = validateSearchRequest(body);
    const officeId = await resolveOfficeId(appDb, userId, body.office_id);
    const apiKey = await resolveOfficeApiKey(
      appDb,
      c.env.BETTER_AUTH_SECRET,
      officeId,
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
    const appDb = db(c.env);
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const request = validateScrapeRequest(body);
    const officeId = await resolveOfficeId(appDb, userId, body.office_id);
    const apiKey = await resolveOfficeApiKey(
      appDb,
      c.env.BETTER_AUTH_SECRET,
      officeId,
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
    const appDb = db(c.env);
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const name = validateMcpName(body.name);
    const url = validateMcpUrl(body.url);
    const authType = validateMcpAuthType(body.auth_type ?? "none");
    const scope = validateMcpScope(body.scope ?? "global");
    const officeId = await resolveOfficeId(appDb, userId, body.office_id);

    const id = crypto.randomUUID();

    // If api_key auth, encrypt and store the key
    if (authType === "api_key") {
      const apiKey = validateApiKeyInput(body.api_key);
      const encrypted = await encryptApiKey(
        c.env.BETTER_AUTH_SECRET,
        officeId,
        apiKey
      );
      await upsertUserApiKey(appDb, officeId, userId, `mcp:${id}`, encrypted);
    }

    const server = await addMcpServer(
      appDb,
      id,
      userId,
      name,
      url,
      authType,
      scope
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
  const appDb = db(c.env);
  const userId = getUserId(c);
  const id = validateUuid(c.req.param("id"));
  const deleted = await deleteMcpServer(appDb, id, userId);

  if (!deleted) {
    throw new HTTPException(404, { message: "MCP server not found" });
  }

  // Fire-and-forget cleanup of associated encrypted key (don't block response)
  const officeIdQuery = c.req.query("office_id");
  c.executionCtx.waitUntil(
    (async () => {
      const officeId = await resolveOfficeId(appDb, userId, officeIdQuery);
      await deleteUserApiKey(appDb, officeId, userId, `mcp:${id}`);
    })().catch(() => undefined)
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

// ── GitHub ──

const VALID_AFFILIATIONS = new Set([
  "owner",
  "collaborator",
  "organization_member",
]);
const DEFAULT_AFFILIATION = "owner,collaborator,organization_member";

function validateAffiliation(value: string | undefined): string {
  if (value === undefined || value === "") {
    return DEFAULT_AFFILIATION;
  }
  const parts = value.split(",");
  for (const part of parts) {
    if (!VALID_AFFILIATIONS.has(part.trim())) {
      throw new HTTPException(400, {
        message:
          "affiliation must be a comma-separated list of: owner, collaborator, organization_member",
      });
    }
  }
  return value;
}

app.get("/api/github/repos", async (c) => {
  const token = await getGithubToken(c);
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const affiliation = validateAffiliation(c.req.query("affiliation"));
  const repos = await listUserRepos(token, {
    perPage: limit,
    page: Math.floor(offset / limit) + 1,
    affiliation,
  });
  return c.json(repos);
});

app.get("/api/github/repos/:owner/:repo/branches", async (c) => {
  const token = await getGithubToken(c);
  const owner = validateOwner(c.req.param("owner"));
  const repo = validateRepoName(c.req.param("repo"));
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const branches = await listBranches(token, owner, repo, {
    perPage: limit,
    page: Math.floor(offset / limit) + 1,
  });
  return c.json(branches);
});

app.post(
  "/api/github/repos/:owner/:repo/branches",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const token = await getGithubToken(c);
    const owner = validateOwner(c.req.param("owner"));
    const repo = validateRepoName(c.req.param("repo"));
    const body = await parseJsonBody(c);
    const name = validateBranchName(body.name, "name");
    const from = validateBranchName(body.from, "from");
    const branch = await createBranch(token, owner, repo, {
      name,
      from,
    });
    return c.json(branch, 201);
  }
);

app.get("/api/github/repos/:owner/:repo/pulls", async (c) => {
  const token = await getGithubToken(c);
  const owner = validateOwner(c.req.param("owner"));
  const repo = validateRepoName(c.req.param("repo"));
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const state = c.req.query("state") ?? "open";
  if (state !== "open" && state !== "closed" && state !== "all") {
    throw new HTTPException(400, {
      message: "state must be 'open', 'closed', or 'all'",
    });
  }
  const pulls = await listPullRequests(token, owner, repo, {
    perPage: limit,
    page: Math.floor(offset / limit) + 1,
    state,
  });
  return c.json(pulls);
});

app.post(
  "/api/github/repos/:owner/:repo/pulls",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const token = await getGithubToken(c);
    const owner = validateOwner(c.req.param("owner"));
    const repo = validateRepoName(c.req.param("repo"));
    const body = await parseJsonBody(c);
    const title = validateTitle(body.title);
    const head = validateBranchName(body.head, "head");
    const base = validateBranchName(body.base, "base");
    const prBody = validateOptionalText(body.body, "body", 20_000) ?? undefined;

    const pr = await createPullRequest(token, owner, repo, {
      title,
      head,
      base,
      body: prBody,
    });

    return c.json(pr, 201);
  }
);

app.get("/api/github/repos/:owner/:repo/pulls/:pull_number", async (c) => {
  const token = await getGithubToken(c);
  const owner = validateOwner(c.req.param("owner"));
  const repo = validateRepoName(c.req.param("repo"));
  const pullNumber = validatePullNumber(c.req.param("pull_number"));

  const [pr, checkRuns] = await Promise.all([
    getPullRequest(token, owner, repo, pullNumber),
    getCheckRuns(token, owner, repo, `refs/pull/${pullNumber}/head`),
  ]);

  return c.json({ pr, check_runs: checkRuns });
});

// ── Projects / Workspaces ──

app.post(
  "/api/projects",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const appDb = db(c.env);
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const parsedRepo = canonicalizeGithubRepoUrl(body.repo_url);
    const defaultBranch = validateOptionalText(
      body.default_branch,
      "default_branch",
      255
    );
    const officeId = await resolveOfficeId(appDb, userId, body.office_id);

    const existing = await getProjectByRepoUrl(
      appDb,
      userId,
      parsedRepo.repo_url,
      officeId
    );
    if (existing) {
      return c.json(existing);
    }

    const project = await createProject(
      appDb,
      crypto.randomUUID(),
      userId,
      parsedRepo.repo_url,
      parsedRepo.owner,
      parsedRepo.repo,
      defaultBranch,
      officeId
    );
    return c.json(project, 201);
  }
);

app.get("/api/projects", async (c) => {
  const appDb = db(c.env);
  const userId = getUserId(c);
  const officeId = await resolveOptionalOfficeId(
    appDb,
    userId,
    c.req.query("office_id")
  );
  const projects = await listProjects(appDb, userId, officeId);
  return c.json(projects);
});

app.post(
  "/api/workspaces",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const projectId = validateUuid(body.project_id, "project_id");
    const kind = validateWorkspaceKind(body.kind);
    const workspaceId = crypto.randomUUID();
    const project = await getProject(db(c.env), projectId, userId);
    const defaultName = "Cloud workspace";
    const name =
      body.name === undefined ? defaultName : validateWorkspaceName(body.name);
    const baseBranch =
      body.base_branch === undefined
        ? (project.default_branch ?? DEFAULT_BRANCH_FALLBACK)
        : validateBranchName(body.base_branch, "base_branch");
    const workingBranch =
      body.working_branch === undefined
        ? toWorkspaceBranchName(workspaceId)
        : validateBranchName(body.working_branch, "working_branch");
    const remoteUrl = validateOptionalText(body.remote_url, "remote_url", 500);
    const localPath = validateOptionalPath(body.local_path, "local_path");
    const status =
      body.status === undefined
        ? "ready"
        : validateWorkspaceStatus(body.status);

    const workspace = await createWorkspace(db(c.env), {
      id: workspaceId,
      userId,
      projectId,
      kind,
      name,
      baseBranch,
      workingBranch,
      remoteUrl,
      localPath,
      status,
    });
    return c.json(workspace, 201);
  }
);

app.get("/api/workspaces", async (c) => {
  const appDb = db(c.env);
  const userId = getUserId(c);
  const projectIdQuery = c.req.query("project_id");
  const projectId =
    projectIdQuery === undefined
      ? undefined
      : validateUuid(projectIdQuery, "project_id");
  const officeId = await resolveOptionalOfficeId(
    appDb,
    userId,
    c.req.query("office_id")
  );
  const workspaces = await listWorkspaces(appDb, userId, projectId, officeId);
  return c.json(workspaces);
});

app.get("/api/workspaces/:id", async (c) => {
  const userId = getUserId(c);
  const workspaceId = validateUuid(c.req.param("id"), "workspace_id");
  const workspace = await getWorkspace(db(c.env), workspaceId, userId);
  return c.json(workspace);
});

// ── Conversations ──

app.post(
  "/api/conversations",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const appDb = db(c.env);
    const userId = getUserId(c);
    const body = await parseJsonBody(c);
    const title =
      body.title !== undefined ? validateTitle(body.title) : "New Conversation";
    const executionTarget = validateExecutionTarget(
      body.execution_target ?? "sandbox"
    );
    const workspaceId =
      body.workspace_id === undefined
        ? undefined
        : validateNullableUuid(body.workspace_id, "workspace_id");
    const officeId = await resolveOptionalOfficeId(
      appDb,
      userId,
      body.office_id
    );
    const id = crypto.randomUUID();
    const conversation = await createConversation(
      appDb,
      id,
      userId,
      title,
      executionTarget,
      workspaceId,
      officeId
    );
    return c.json(conversation, 201);
  }
);

app.get("/api/conversations", async (c) => {
  const appDb = db(c.env);
  const userId = getUserId(c);
  const { limit, offset } = validatePagination(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const executionTargetQuery = c.req.query("execution_target");
  const executionTarget =
    executionTargetQuery === undefined
      ? undefined
      : validateExecutionTarget(executionTargetQuery);
  const workspaceIdQuery = c.req.query("workspace_id");
  const workspaceId =
    workspaceIdQuery === undefined
      ? undefined
      : validateUuid(workspaceIdQuery, "workspace_id");
  const officeId = await resolveOptionalOfficeId(
    appDb,
    userId,
    c.req.query("office_id")
  );
  const conversations = await listConversations(
    appDb,
    userId,
    limit,
    offset,
    executionTarget,
    workspaceId,
    officeId
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

app.patch(
  "/api/conversations/:id/execution-target",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const id = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const executionTarget = validateExecutionTarget(body.execution_target);
    await setConversationExecutionTarget(
      db(c.env),
      id,
      userId,
      executionTarget
    );
    return c.json({ ok: true });
  }
);

app.patch(
  "/api/conversations/:id/workspace",
  bodyLimit({ maxSize: MAX_REQUEST_BYTES }),
  async (c) => {
    const userId = getUserId(c);
    const id = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const workspaceId = validateNullableUuid(body.workspace_id, "workspace_id");
    await setConversationWorkspace(db(c.env), id, userId, workspaceId);
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
    const appDb = db(c.env);
    const userId = getUserId(c);
    const conversationId = validateUuid(c.req.param("id"));
    const body = await parseJsonBody(c);
    const { content, trigger, skillIds, messages } =
      await normalizeChatRequest(body);

    const conversation = await getConversation(appDb, conversationId, userId);
    const officeId = conversation.office_id;
    let lettaApiKey: string | undefined;
    try {
      lettaApiKey = await resolveOfficeApiKey(
        appDb,
        c.env.BETTER_AUTH_SECRET,
        officeId,
        userId,
        "letta"
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 422) {
        lettaApiKey = c.env.LETTA_API_KEY;
      } else {
        throw error;
      }
    }
    if (!lettaApiKey) {
      throw new HTTPException(422, {
        message: "Letta API key not configured. Add your key in Settings.",
      });
    }
    return streamChat(
      appDb,
      lettaApiKey,
      conversationId,
      userId,
      {
        content,
        messages,
        trigger,
        skillIds,
      },
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
