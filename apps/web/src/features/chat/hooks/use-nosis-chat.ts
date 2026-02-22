"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  conversationChatPath,
  listConversationMessages,
  toUiMessages,
} from "@nosis/features/chat/api/worker-chat-api";
import { ApiError } from "@nosis/features/shared/api/worker-http-client";

const HISTORY_RETRY_DELAY_MS = 300;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function toHistoryError(error: unknown): Error {
  if (error instanceof ApiError && error.status >= 500) {
    return new Error(
      "Could not load chat history right now. Please retry in a moment."
    );
  }
  return error instanceof Error
    ? error
    : new Error("Failed to load chat history");
}

function lastUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    return text;
  }
  return "";
}

function skillIdsFromRequestMetadata(metadata: unknown): string[] | undefined {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("skillIds" in metadata)
  ) {
    return undefined;
  }

  const value = (metadata as { skillIds?: unknown }).skillIds;
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? parsed : undefined;
}

export function useNosisChat(conversationId: string) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: conversationChatPath(conversationId),
        credentials: "include",
        prepareSendMessagesRequest: ({
          messages,
          trigger,
          messageId,
          requestMetadata,
        }) => {
          const skillIds = skillIdsFromRequestMetadata(requestMetadata);
          return {
            body: {
              messages,
              trigger,
              message_id: messageId,
              ...(skillIds ? { skill_ids: skillIds } : {}),
              // Legacy fallback field for older backend instances.
              content: lastUserText(messages),
            },
          };
        },
      }),
    [conversationId]
  );

  const { setMessages, ...chat } = useChat({
    id: conversationId,
    transport,
  });

  const [isHydratingHistory, setIsHydratingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<Error | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;

    setIsHydratingHistory(true);
    setHistoryError(undefined);
    setMessages([]);

    const loadHistory = async () => {
      try {
        return await listConversationMessages(conversationId);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 500) {
          throw error;
        }
      }

      await sleep(HISTORY_RETRY_DELAY_MS);
      return await listConversationMessages(conversationId);
    };

    loadHistory()
      .then((history) => {
        if (cancelled) {
          return;
        }
        setMessages(toUiMessages(history));
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setHistoryError(toHistoryError(err));
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydratingHistory(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, setMessages]);

  return {
    ...chat,
    setMessages,
    isHydratingHistory,
    historyError,
  };
}
