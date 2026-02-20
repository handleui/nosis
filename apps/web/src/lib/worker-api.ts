import { API_URL } from "@nosis/lib/auth-client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  letta_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export function assertUuid(value: string, field = "ID"): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
}

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

async function apiFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(408, "Request timed out");
    }
    throw error;
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

export async function createConversation(
  title?: string
): Promise<Conversation> {
  const response = await apiFetch("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return (await response.json()) as Conversation;
}

export async function listConversations(
  limit = 50,
  offset = 0
): Promise<Conversation[]> {
  const page = safePagination(limit, offset);
  const response = await apiFetch(
    `/api/conversations?limit=${page.limit}&offset=${page.offset}`
  );
  return (await response.json()) as Conversation[];
}

export function conversationChatPath(conversationId: string): string {
  assertUuid(conversationId, "conversation ID");
  return `${API_URL}/api/conversations/${conversationId}/chat`;
}
