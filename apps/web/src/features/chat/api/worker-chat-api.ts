import { API_URL } from "@nosis/lib/api-config";
import type { UIMessage } from "ai";
import type { CloudExecutionTarget } from "@nosis/agent-runtime/execution";
import {
  assertUuid,
  safePagination,
} from "@nosis/features/shared/api/worker-api-validation";
import {
  workerFetch,
  workerJson,
} from "@nosis/features/shared/api/worker-http-client";

export type ConversationExecutionTarget = CloudExecutionTarget;

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  letta_agent_id: string | null;
  execution_target: ConversationExecutionTarget;
  office_id: string;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface ConversationMessageMetadata {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: string;
}

export async function createConversation(options?: {
  title?: string;
  executionTarget?: ConversationExecutionTarget;
  workspaceId?: string | null;
  officeId?: string;
}): Promise<Conversation> {
  if (typeof options?.workspaceId === "string") {
    assertUuid(options.workspaceId, "workspace ID");
  }
  if (options?.officeId) {
    assertUuid(options.officeId, "office ID");
  }
  return await workerJson<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      title: options?.title,
      execution_target: options?.executionTarget,
      office_id: options?.officeId,
      workspace_id: options?.workspaceId,
    }),
  });
}

export async function listConversations(
  limit = 50,
  offset = 0,
  executionTarget?: ConversationExecutionTarget,
  workspaceId?: string | null,
  officeId?: string
): Promise<Conversation[]> {
  const page = safePagination(limit, offset);
  const searchParams = new URLSearchParams({
    limit: String(page.limit),
    offset: String(page.offset),
  });
  if (executionTarget) {
    searchParams.set("execution_target", executionTarget);
  }
  if (workspaceId) {
    searchParams.set("workspace_id", workspaceId);
  }
  if (officeId) {
    searchParams.set("office_id", officeId);
  }

  return await workerJson<Conversation[]>(
    `/api/conversations?${searchParams.toString()}`
  );
}

export async function getConversation(id: string): Promise<Conversation> {
  assertUuid(id, "conversation ID");
  return await workerJson<Conversation>(`/api/conversations/${id}`);
}

export async function listConversationMessages(
  conversationId: string,
  limit = 200,
  offset = 0
): Promise<ConversationMessage[]> {
  assertUuid(conversationId, "conversation ID");
  const page = safePagination(limit, offset, 500);
  return await workerJson<ConversationMessage[]>(
    `/api/conversations/${conversationId}/messages?limit=${page.limit}&offset=${page.offset}`
  );
}

export async function setConversationExecutionTarget(
  conversationId: string,
  executionTarget: ConversationExecutionTarget
): Promise<void> {
  assertUuid(conversationId, "conversation ID");
  await workerFetch(`/api/conversations/${conversationId}/execution-target`, {
    method: "PATCH",
    body: JSON.stringify({ execution_target: executionTarget }),
  });
}

export async function setConversationWorkspace(
  conversationId: string,
  workspaceId: string | null
): Promise<void> {
  assertUuid(conversationId, "conversation ID");
  if (workspaceId !== null) {
    assertUuid(workspaceId, "workspace ID");
  }
  await workerFetch(`/api/conversations/${conversationId}/workspace`, {
    method: "PATCH",
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

export function toUiMessages(messages: ConversationMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    metadata: {
      ...(message.model ? { model: message.model } : {}),
      ...(message.tokens_in !== null ? { tokensIn: message.tokens_in } : {}),
      ...(message.tokens_out !== null ? { tokensOut: message.tokens_out } : {}),
      createdAt: message.created_at,
    } satisfies ConversationMessageMetadata,
    parts: [
      {
        type: "text",
        text: message.content,
      },
    ],
  }));
}

export function conversationChatPath(conversationId: string): string {
  assertUuid(conversationId, "conversation ID");
  return `${API_URL}/api/conversations/${conversationId}/chat`;
}
