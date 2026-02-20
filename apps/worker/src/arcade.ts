import { HTTPException } from "hono/http-exception";
import { sanitizeError } from "./sanitize";

const ARCADE_BASE_URL = "https://api.arcade.dev";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TOOL_NAME_LENGTH = 200;
const MAX_USER_ID_LENGTH = 200;
const MAX_TOOLKIT_LENGTH = 200;
const MAX_LIMIT = 500;
const MAX_AUTH_ID_LENGTH = 200;
const MAX_WAIT_SECONDS = 59;

const TOOL_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const AUTH_ID_REGEX = /^[a-zA-Z0-9._:-]+$/;

// ── Response types ──

export interface ArcadeTool {
  name: string;
  description: string;
  toolkit: {
    name: string;
    description: string;
  };
  requires_authorization: boolean;
}

export interface ToolsListResponse {
  tools: ArcadeTool[];
  total_count: number;
}

export interface AuthorizeResponse {
  authorization_id: string;
  authorization_url: string | null;
  status: string;
}

export interface AuthStatusResponse {
  authorization_id: string;
  status: string;
  context?: Record<string, unknown>;
}

// ── Validation helpers ──

function validateToolName(name: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_TOOL_NAME_LENGTH ||
    !TOOL_NAME_REGEX.test(name)
  ) {
    throw new HTTPException(400, { message: "Invalid tool name" });
  }
}

function validateUserId(userId: string): void {
  if (userId.length === 0 || userId.length > MAX_USER_ID_LENGTH) {
    throw new HTTPException(400, { message: "Invalid user ID" });
  }
}

// ── API functions ──

async function arcadeFetch<T>(
  apiKey: string,
  path: string,
  options: {
    method?: string;
    body?: string;
    timeoutMs?: number;
    userId?: string;
  } = {}
): Promise<T> {
  const url = `${ARCADE_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.userId) {
    headers["Arcade-User-ID"] = options.userId;
  }

  const response = await fetch(url, {
    method: options.method,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    headers,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      detail = sanitizeError(body, [apiKey]);
    } catch {
      // ignore body read failure
    }
    throw new HTTPException(502, {
      message: `Arcade API error (${response.status}): ${detail || "Unknown error"}`,
    });
  }

  return response.json() as Promise<T>;
}

export async function listTools(
  apiKey: string,
  userId: string,
  toolkit?: string,
  limit?: number
): Promise<ToolsListResponse> {
  validateUserId(userId);
  if (toolkit !== undefined && toolkit.length > MAX_TOOLKIT_LENGTH) {
    throw new HTTPException(400, { message: "Toolkit name too long" });
  }

  const params = new URLSearchParams();
  if (toolkit) {
    params.set("toolkit", toolkit);
  }
  if (limit !== undefined) {
    params.set("limit", String(Math.min(Math.max(1, limit), MAX_LIMIT)));
  }

  const query = params.toString();
  const path = `/v1/tools${query ? `?${query}` : ""}`;
  return await arcadeFetch<ToolsListResponse>(apiKey, path, { userId });
}

export async function authorizeTool(
  apiKey: string,
  userId: string,
  toolName: string
): Promise<AuthorizeResponse> {
  validateUserId(userId);
  validateToolName(toolName);

  return await arcadeFetch<AuthorizeResponse>(apiKey, "/v1/tools/authorize", {
    userId,
    method: "POST",
    body: JSON.stringify({ tool_name: toolName, user_id: userId }),
  });
}

export async function checkAuthStatus(
  apiKey: string,
  authorizationId: string,
  wait?: number
): Promise<AuthStatusResponse> {
  if (
    authorizationId.length === 0 ||
    authorizationId.length > MAX_AUTH_ID_LENGTH ||
    !AUTH_ID_REGEX.test(authorizationId)
  ) {
    throw new HTTPException(400, { message: "Invalid authorization ID" });
  }

  const params = new URLSearchParams();
  params.set("id", authorizationId);
  const clampedWait =
    wait !== undefined
      ? Math.min(Math.max(0, wait), MAX_WAIT_SECONDS)
      : undefined;
  if (clampedWait !== undefined) {
    params.set("wait", String(clampedWait));
  }

  // When long-polling, extend the fetch timeout to cover the server-side wait.
  const timeoutMs =
    clampedWait !== undefined ? (clampedWait + 5) * 1000 : FETCH_TIMEOUT_MS;
  return await arcadeFetch<AuthStatusResponse>(
    apiKey,
    `/v1/auth/status?${params.toString()}`,
    { timeoutMs }
  );
}
