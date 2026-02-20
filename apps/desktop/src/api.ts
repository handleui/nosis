const BASE_URL =
  import.meta.env.VITE_WORKER_URL ?? "http://nosis-api.localhost:1355";

// Rejects characters that could alter URL path structure (path traversal guard).
const INVALID_SEGMENT_RE = /[/\\.\s]/;

// Validates that an id-like segment cannot introduce path traversal.
// Accepts UUIDs, alphanumeric slugs, and simple identifiers; rejects
// anything containing '/', '\', '.', or whitespace.
function validatePathSegment(value: string, field: string): void {
  if (!value || value.length > 256) {
    throw new Error(`${field} must be 1-256 characters`);
  }
  if (INVALID_SEGMENT_RE.test(value)) {
    throw new Error(`${field} contains invalid characters`);
  }
}

let authToken: string | undefined;

export function setAuthToken(token: string | undefined) {
  authToken = token;
}

export function getAuthToken(): string | undefined {
  return authToken;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

async function apiFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(options?.headers);
  // Only set Content-Type when a body is present — setting it on GET/DELETE
  // requests with no body triggers unnecessary CORS preflight and can confuse
  // some proxies and CDN edges.
  if (options?.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: "omit",
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(408, "Request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body: unknown = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    const isErrorObj =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "string";
    const message = isErrorObj
      ? (body as { error: string }).error
      : "Request failed";
    throw new ApiError(response.status, message);
  }
  return response;
}

// Types mirroring Worker API responses
export interface Conversation {
  id: string;
  title: string;
  userId: string;
  lettaAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

// Conversation endpoints
export async function createConversation(
  title?: string
): Promise<Conversation> {
  const res = await apiFetch("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return (await res.json()) as Conversation;
}

// Clamps pagination params to safe server-side ranges.
function safePagination(
  limit: number,
  offset: number,
  maxLimit = 200
): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(Math.floor(limit), maxLimit)),
    offset: Math.max(0, Math.floor(offset)),
  };
}

export async function listConversations(
  limit = 50,
  offset = 0
): Promise<Conversation[]> {
  const p = safePagination(limit, offset);
  const res = await apiFetch(
    `/api/conversations?limit=${p.limit}&offset=${p.offset}`
  );
  return (await res.json()) as Conversation[];
}

export async function getConversation(id: string): Promise<Conversation> {
  validatePathSegment(id, "Conversation ID");
  const res = await apiFetch(`/api/conversations/${id}`);
  return (await res.json()) as Conversation;
}

export async function updateConversationTitle(
  id: string,
  title: string
): Promise<void> {
  validatePathSegment(id, "Conversation ID");
  await apiFetch(`/api/conversations/${id}/title`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  validatePathSegment(id, "Conversation ID");
  await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
}

export async function setConversationAgentId(
  id: string,
  agentId: string
): Promise<void> {
  validatePathSegment(id, "Conversation ID");
  await apiFetch(`/api/conversations/${id}/agent`, {
    method: "PATCH",
    body: JSON.stringify({ agent_id: agentId }),
  });
}

// Message endpoints
export async function getMessages(
  conversationId: string,
  limit = 100,
  offset = 0
): Promise<Message[]> {
  validatePathSegment(conversationId, "Conversation ID");
  const p = safePagination(limit, offset);
  const res = await apiFetch(
    `/api/conversations/${conversationId}/messages?limit=${p.limit}&offset=${p.offset}`
  );
  return (await res.json()) as Message[];
}

export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  opts?: { model?: string; tokensIn?: number; tokensOut?: number }
): Promise<Message> {
  validatePathSegment(conversationId, "Conversation ID");
  const res = await apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role,
      content,
      model: opts?.model,
      tokens_in: opts?.tokensIn,
      tokens_out: opts?.tokensOut,
    }),
  });
  return (await res.json()) as Message;
}
