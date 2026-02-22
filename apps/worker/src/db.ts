import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import {
  conversations,
  offices,
  mcpServers,
  messages,
  projects,
  userApiKeys,
  workspaces,
} from "./schema";
import type * as schema from "./schema";
import type {
  Conversation,
  ConversationExecutionTarget,
  McpServer,
  McpServerScope,
  Message,
  Office,
  Project,
  Workspace,
  WorkspaceKind,
  WorkspaceStatus,
} from "./types";

export type AppDatabase = DrizzleD1Database<typeof schema>;
export type MessageRole = (typeof messages.$inferInsert)["role"];

export interface UserApiKeyMeta {
  provider: string;
  created_at: string;
  updated_at: string;
}

function notFound(entity: string): never {
  throw new HTTPException(404, { message: `${entity} not found` });
}

const PERSONAL_OFFICE_SLUG = "personal";
const PERSONAL_OFFICE_NAME = "Personal";

function slugifyOfficeName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 64) : "office";
}

async function getOfficeOrNull(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Office | null> {
  const row = await db
    .select()
    .from(offices)
    .where(and(eq(offices.id, id), eq(offices.user_id, userId)))
    .get();

  return row ?? null;
}

async function getOrCreatePersonalOffice(
  db: AppDatabase,
  userId: string
): Promise<Office> {
  const existing = await db
    .select()
    .from(offices)
    .where(
      and(eq(offices.user_id, userId), eq(offices.slug, PERSONAL_OFFICE_SLUG))
    )
    .get();
  if (existing) {
    return existing;
  }

  const inserted = await db
    .insert(offices)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      name: PERSONAL_OFFICE_NAME,
      slug: PERSONAL_OFFICE_SLUG,
    })
    .onConflictDoNothing({
      target: [offices.user_id, offices.slug],
    })
    .returning()
    .get();
  if (inserted) {
    return inserted;
  }

  const row = await db
    .select()
    .from(offices)
    .where(
      and(eq(offices.user_id, userId), eq(offices.slug, PERSONAL_OFFICE_SLUG))
    )
    .get();
  if (!row) {
    throw new HTTPException(500, { message: "Failed to resolve office" });
  }
  return row;
}

async function ensureOfficeForUser(
  db: AppDatabase,
  userId: string,
  officeId?: string
): Promise<Office> {
  if (!officeId) {
    return await getOrCreatePersonalOffice(db, userId);
  }

  const office = await getOfficeOrNull(db, officeId, userId);
  if (!office) {
    notFound("Office");
  }
  return office;
}

function resolveProjectOfficeId(project: Project): string {
  return project.office_id;
}

// ── User API Keys ──

export async function upsertUserApiKey(
  db: AppDatabase,
  officeId: string,
  userId: string,
  provider: string,
  encryptedKey: string
): Promise<void> {
  if (!(await getOfficeOrNull(db, officeId, userId))) {
    notFound("Office");
  }

  await db
    .insert(userApiKeys)
    .values({
      user_id: officeId,
      provider,
      encrypted_key: encryptedKey,
    })
    .onConflictDoUpdate({
      target: [userApiKeys.user_id, userApiKeys.provider],
      set: {
        encrypted_key: encryptedKey,
        updated_at: sql`datetime('now')`,
      },
    });
}

export async function listUserApiKeys(
  db: AppDatabase,
  officeId: string,
  userId: string
): Promise<UserApiKeyMeta[]> {
  if (!(await getOfficeOrNull(db, officeId, userId))) {
    notFound("Office");
  }

  return await db
    .select({
      provider: userApiKeys.provider,
      created_at: userApiKeys.created_at,
      updated_at: userApiKeys.updated_at,
    })
    .from(userApiKeys)
    .where(eq(userApiKeys.user_id, officeId))
    .orderBy(asc(userApiKeys.provider));
}

export async function deleteUserApiKey(
  db: AppDatabase,
  officeId: string,
  userId: string,
  provider: string
): Promise<void> {
  if (!(await getOfficeOrNull(db, officeId, userId))) {
    notFound("Office");
  }

  const result = await db
    .delete(userApiKeys)
    .where(
      and(eq(userApiKeys.user_id, officeId), eq(userApiKeys.provider, provider))
    )
    .returning({ user_id: userApiKeys.user_id });

  if (result.length === 0) {
    throw new HTTPException(404, {
      message: `No API key configured for provider: ${provider}`,
    });
  }
}

// ── MCP Servers ──

export async function addMcpServer(
  db: AppDatabase,
  id: string,
  userId: string,
  name: string,
  url: string,
  authType: string,
  scope: McpServerScope
): Promise<McpServer> {
  const row = await db
    .insert(mcpServers)
    .values({
      id,
      user_id: userId,
      name,
      url,
      auth_type: authType,
      scope,
    })
    .returning()
    .get();

  if (!row) {
    throw new HTTPException(500, { message: "Failed to add MCP server" });
  }
  return row;
}

export async function listMcpServers(
  db: AppDatabase,
  userId: string,
  scopes?: readonly McpServerScope[]
): Promise<McpServer[]> {
  if (!scopes || scopes.length === 0) {
    return await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.user_id, userId))
      .orderBy(asc(mcpServers.created_at));
  }

  return await db
    .select()
    .from(mcpServers)
    .where(
      and(eq(mcpServers.user_id, userId), inArray(mcpServers.scope, scopes))
    )
    .orderBy(asc(mcpServers.created_at));
}

export async function deleteMcpServer(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.id, id), eq(mcpServers.user_id, userId)))
    .returning({ id: mcpServers.id });

  return result.length > 0;
}

export async function getMcpServerByName(
  db: AppDatabase,
  userId: string,
  name: string,
  scope?: McpServerScope
): Promise<McpServer | null> {
  const where = scope
    ? and(
        eq(mcpServers.user_id, userId),
        eq(mcpServers.name, name),
        eq(mcpServers.scope, scope)
      )
    : and(eq(mcpServers.user_id, userId), eq(mcpServers.name, name));

  const row = await db
    .select()
    .from(mcpServers)
    .where(where)
    .orderBy(desc(mcpServers.created_at))
    .get();

  return row ?? null;
}

export async function touchMcpServerUpdatedAt(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<string | null> {
  const row = await db
    .update(mcpServers)
    .set({ updated_at: sql`datetime('now')` })
    .where(and(eq(mcpServers.id, id), eq(mcpServers.user_id, userId)))
    .returning({ updated_at: mcpServers.updated_at })
    .get();

  return row?.updated_at ?? null;
}

// ── Offices ──

export interface CreateOfficeInput {
  id: string;
  userId: string;
  name: string;
}

export async function listOffices(
  db: AppDatabase,
  userId: string
): Promise<Office[]> {
  const rows = await db
    .select()
    .from(offices)
    .where(eq(offices.user_id, userId))
    .orderBy(desc(offices.updated_at));

  if (rows.length > 0) {
    return rows;
  }

  const personal = await getOrCreatePersonalOffice(db, userId);
  return [personal];
}

export async function getDefaultOffice(
  db: AppDatabase,
  userId: string
): Promise<Office> {
  return await getOrCreatePersonalOffice(db, userId);
}

export async function createOffice(
  db: AppDatabase,
  input: CreateOfficeInput
): Promise<Office> {
  const baseSlug = slugifyOfficeName(input.name);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const slug = `${baseSlug}${suffix}`;

    const row = await db
      .insert(offices)
      .values({
        id: input.id,
        user_id: input.userId,
        name: input.name,
        slug,
      })
      .onConflictDoNothing({
        target: [offices.user_id, offices.slug],
      })
      .returning()
      .get();

    if (row) {
      return row;
    }
  }

  throw new HTTPException(500, { message: "Failed to create office" });
}

export async function getOffice(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Office> {
  const row = await getOfficeOrNull(db, id, userId);
  if (!row) {
    notFound("Office");
  }
  return row;
}

// ── Projects / Workspaces ──

export async function createProject(
  db: AppDatabase,
  id: string,
  userId: string,
  repoUrl: string,
  owner: string,
  repo: string,
  defaultBranch: string | null,
  officeId?: string
): Promise<Project> {
  const resolvedOfficeId = (await ensureOfficeForUser(db, userId, officeId)).id;

  const inserted = await db
    .insert(projects)
    .values({
      id,
      user_id: userId,
      office_id: resolvedOfficeId,
      repo_url: repoUrl,
      owner,
      repo,
      default_branch: defaultBranch,
    })
    .onConflictDoNothing({
      target: [projects.user_id, projects.office_id, projects.repo_url],
    })
    .returning()
    .get();

  if (inserted) {
    return inserted;
  }

  const existing = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.user_id, userId),
        eq(projects.office_id, resolvedOfficeId),
        eq(projects.repo_url, repoUrl)
      )
    )
    .get();

  if (!existing) {
    throw new HTTPException(500, {
      message: "Failed to create project",
    });
  }
  return existing;
}

export async function listProjects(
  db: AppDatabase,
  userId: string,
  officeId?: string
): Promise<Project[]> {
  if (officeId) {
    await ensureOfficeForUser(db, userId, officeId);
  }

  const where = officeId
    ? and(eq(projects.user_id, userId), eq(projects.office_id, officeId))
    : eq(projects.user_id, userId);

  return await db
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updated_at));
}

export async function getProject(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Project> {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.user_id, userId)))
    .get();

  if (!row) {
    notFound("Project");
  }
  return row;
}

export async function getProjectByRepoUrl(
  db: AppDatabase,
  userId: string,
  repoUrl: string,
  officeId?: string
): Promise<Project | null> {
  const where = officeId
    ? and(
        eq(projects.user_id, userId),
        eq(projects.office_id, officeId),
        eq(projects.repo_url, repoUrl)
      )
    : and(eq(projects.user_id, userId), eq(projects.repo_url, repoUrl));

  const row = await db.select().from(projects).where(where).get();

  return row ?? null;
}

export interface CreateWorkspaceInput {
  id: string;
  userId: string;
  projectId: string;
  kind: WorkspaceKind;
  name: string;
  baseBranch: string;
  workingBranch: string;
  remoteUrl: string | null;
  localPath: string | null;
  status: WorkspaceStatus;
}

export async function createWorkspace(
  db: AppDatabase,
  input: CreateWorkspaceInput
): Promise<Workspace> {
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, input.projectId), eq(projects.user_id, input.userId))
    )
    .get();

  if (!project) {
    notFound("Project");
  }

  const row = await db
    .insert(workspaces)
    .values({
      id: input.id,
      user_id: input.userId,
      project_id: input.projectId,
      kind: input.kind,
      name: input.name,
      base_branch: input.baseBranch,
      working_branch: input.workingBranch,
      remote_url: input.remoteUrl,
      local_path: input.localPath,
      status: input.status,
    })
    .returning()
    .get();

  if (!row) {
    throw new HTTPException(500, {
      message: "Failed to create workspace",
    });
  }
  return row;
}

export async function listWorkspaces(
  db: AppDatabase,
  userId: string,
  projectId?: string,
  officeId?: string
): Promise<Workspace[]> {
  const conditions = [eq(workspaces.user_id, userId)];
  if (projectId) {
    conditions.push(eq(workspaces.project_id, projectId));
  }

  if (officeId) {
    await ensureOfficeForUser(db, userId, officeId);
    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.user_id, userId), eq(projects.office_id, officeId))
      );
    const projectIds = projectRows.map((row) => row.id);
    if (projectIds.length === 0) {
      return [];
    }
    conditions.push(inArray(workspaces.project_id, projectIds));
  }

  return await db
    .select()
    .from(workspaces)
    .where(and(...conditions))
    .orderBy(desc(workspaces.updated_at));
}

export async function getWorkspace(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Workspace> {
  const row = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.user_id, userId)))
    .get();

  if (!row) {
    notFound("Workspace");
  }
  return row;
}

async function getWorkspaceOrNull(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Workspace | null> {
  const row = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.user_id, userId)))
    .get();

  return row ?? null;
}

// ── Conversations ──

export async function createConversation(
  db: AppDatabase,
  id: string,
  userId: string,
  title: string,
  executionTarget: ConversationExecutionTarget,
  workspaceId?: string | null,
  officeId?: string
): Promise<Conversation> {
  let resolvedExecutionTarget = executionTarget;
  let resolvedWorkspaceId: string | null = null;
  let resolvedOfficeId: string;

  if (workspaceId) {
    const workspace = await getWorkspaceOrNull(db, workspaceId, userId);
    if (!workspace) {
      notFound("Workspace");
    }

    const project = await getProject(db, workspace.project_id, userId);
    const projectOfficeId = resolveProjectOfficeId(project);
    if (officeId && officeId !== projectOfficeId) {
      throw new HTTPException(400, {
        message:
          "conversation office must match the workspace's office when workspace_id is provided",
      });
    }

    resolvedWorkspaceId = workspace.id;
    resolvedOfficeId = projectOfficeId;
    resolvedExecutionTarget = "sandbox";
  } else {
    resolvedOfficeId = (await ensureOfficeForUser(db, userId, officeId)).id;
  }

  const row = await db
    .insert(conversations)
    .values({
      id,
      user_id: userId,
      title,
      execution_target: resolvedExecutionTarget,
      office_id: resolvedOfficeId,
      workspace_id: resolvedWorkspaceId,
    })
    .returning()
    .get();

  if (!row) {
    throw new HTTPException(500, {
      message: "Failed to create conversation",
    });
  }
  return row;
}

export async function listConversations(
  db: AppDatabase,
  userId: string,
  limit: number,
  offset: number,
  executionTarget?: ConversationExecutionTarget,
  workspaceId?: string,
  officeId?: string
): Promise<Conversation[]> {
  if (officeId) {
    await ensureOfficeForUser(db, userId, officeId);
  }

  const conditions = [eq(conversations.user_id, userId)];
  if (executionTarget) {
    conditions.push(eq(conversations.execution_target, executionTarget));
  }
  if (workspaceId) {
    conditions.push(eq(conversations.workspace_id, workspaceId));
  }
  if (officeId) {
    conditions.push(eq(conversations.office_id, officeId));
  }

  const rows = await db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updated_at))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getConversation(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<Conversation> {
  const row = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .get();

  if (!row) {
    notFound("Conversation");
  }
  return row;
}

export async function updateConversationTitle(
  db: AppDatabase,
  id: string,
  userId: string,
  title: string
): Promise<void> {
  const result = await db
    .update(conversations)
    .set({ title, updated_at: sql`datetime('now')` })
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

export async function deleteConversation(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<void> {
  const result = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

export async function setConversationAgentId(
  db: AppDatabase,
  id: string,
  userId: string,
  agentId: string
): Promise<void> {
  const result = await db
    .update(conversations)
    .set({ letta_agent_id: agentId, updated_at: sql`datetime('now')` })
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

export async function setConversationExecutionTarget(
  db: AppDatabase,
  id: string,
  userId: string,
  executionTarget: ConversationExecutionTarget
): Promise<void> {
  const conversation = await db
    .select({
      id: conversations.id,
      workspace_id: conversations.workspace_id,
    })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .get();

  if (!conversation) {
    notFound("Conversation");
  }

  if (conversation.workspace_id) {
    const workspace = await getWorkspaceOrNull(
      db,
      conversation.workspace_id,
      userId
    );
    if (!workspace) {
      notFound("Workspace");
    }

    const expectedTarget: ConversationExecutionTarget = "sandbox";
    if (executionTarget !== expectedTarget) {
      throw new HTTPException(400, {
        message:
          "execution_target must match the attached workspace kind. Detach workspace first to set a custom target.",
      });
    }
  }

  const result = await db
    .update(conversations)
    .set({
      execution_target: executionTarget,
      updated_at: sql`datetime('now')`,
    })
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

export async function setConversationWorkspace(
  db: AppDatabase,
  id: string,
  userId: string,
  workspaceId: string | null
): Promise<void> {
  let nextExecutionTarget: ConversationExecutionTarget | null = null;
  let nextOfficeId: string | undefined;
  if (workspaceId !== null) {
    const workspace = await getWorkspaceOrNull(db, workspaceId, userId);
    if (!workspace) {
      notFound("Workspace");
    }

    const project = await getProject(db, workspace.project_id, userId);
    nextOfficeId = resolveProjectOfficeId(project);
    nextExecutionTarget = "sandbox";
  }

  if (nextExecutionTarget !== null && !nextOfficeId) {
    throw new HTTPException(500, {
      message: "Failed to resolve workspace office",
    });
  }

  const updateValues =
    nextExecutionTarget === null
      ? {
          workspace_id: workspaceId,
          updated_at: sql`datetime('now')`,
        }
      : {
          workspace_id: workspaceId,
          office_id: nextOfficeId,
          execution_target: nextExecutionTarget,
          updated_at: sql`datetime('now')`,
        };

  const result = await db
    .update(conversations)
    .set(updateValues)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning({ id: conversations.id })
    .get();

  if (!result) {
    notFound("Conversation");
  }
}

/** Atomically set agent ID only if not already set. Returns true if this call won. */
export async function trySetConversationAgentId(
  db: AppDatabase,
  id: string,
  userId: string,
  agentId: string
): Promise<boolean> {
  const result = await db
    .update(conversations)
    .set({ letta_agent_id: agentId, updated_at: sql`datetime('now')` })
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.user_id, userId),
        isNull(conversations.letta_agent_id)
      )
    )
    .returning({ id: conversations.id });
  return result.length > 0;
}

/**
 * Lightweight lookup returning only the agent ID (or null). Throws 404 if not found
 * or not owned by userId.
 */
export async function getConversationAgentId(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<string | null> {
  const row = await db
    .select({ letta_agent_id: conversations.letta_agent_id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .get();

  if (!row) {
    notFound("Conversation");
  }
  return row.letta_agent_id;
}

export interface ConversationRuntime {
  letta_agent_id: string | null;
  execution_target: ConversationExecutionTarget;
  office_id: string;
}

export async function getConversationRuntime(
  db: AppDatabase,
  id: string,
  userId: string
): Promise<ConversationRuntime> {
  const row = await db
    .select({
      id: conversations.id,
      letta_agent_id: conversations.letta_agent_id,
      execution_target: conversations.execution_target,
      office_id: conversations.office_id,
    })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .get();

  if (!row) {
    notFound("Conversation");
  }
  return {
    letta_agent_id: row.letta_agent_id,
    execution_target: row.execution_target,
    office_id: row.office_id,
  };
}

// ── Messages ──

export async function getMessages(
  db: AppDatabase,
  conversationId: string,
  userId: string,
  limit: number,
  offset: number
): Promise<Message[]> {
  const [convCheck, msgs] = await db.batch([
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.user_id, userId)
        )
      ),
    db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, conversationId))
      .orderBy(asc(messages.created_at))
      .limit(limit)
      .offset(offset),
  ]);

  if (convCheck.length === 0) {
    notFound("Conversation");
  }

  return msgs;
}

export async function saveMessage(
  db: AppDatabase,
  id: string,
  conversationId: string,
  userId: string,
  role: MessageRole,
  content: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number
): Promise<Message> {
  // Verify ownership BEFORE inserting. D1 batch executes all statements
  // regardless of earlier results, so a single batch would insert the message
  // even when the ownership check fails (TOCTOU authorization bypass).
  const convCheck = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.user_id, userId)
      )
    );

  if (convCheck.length === 0) {
    notFound("Conversation");
  }

  // Ownership confirmed — touch updated_at and insert in one batch.
  const [, inserted] = await db.batch([
    db
      .update(conversations)
      .set({ updated_at: sql`datetime('now')` })
      .where(eq(conversations.id, conversationId)),
    db
      .insert(messages)
      .values({
        id,
        conversation_id: conversationId,
        role,
        content,
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      })
      .returning(),
  ]);

  const row = inserted[0];
  if (!row) {
    throw new HTTPException(500, { message: "Failed to save message" });
  }
  return row;
}

/** Insert a message without the conversation-existence check. */
export async function saveMessageBatch(
  db: AppDatabase,
  id: string,
  conversationId: string,
  role: MessageRole,
  content: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number
): Promise<Message> {
  const [, inserted] = await db.batch([
    db
      .update(conversations)
      .set({ updated_at: sql`datetime('now')` })
      .where(eq(conversations.id, conversationId)),
    db
      .insert(messages)
      .values({
        id,
        conversation_id: conversationId,
        role,
        content,
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      })
      .returning(),
  ]);

  const row = inserted[0];
  if (!row) {
    throw new HTTPException(500, { message: "Failed to save message" });
  }
  return row;
}
