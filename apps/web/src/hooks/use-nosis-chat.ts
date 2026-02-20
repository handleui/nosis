"use client";

import { useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { API_URL } from "@nosis/lib/auth-client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useNosisChat(conversationId: string) {
  // Defense-in-depth: validate before interpolating into the fetch URL to
  // prevent path-traversal or query-injection via a corrupted route param.
  if (!UUID_RE.test(conversationId)) {
    throw new Error("Invalid conversation ID");
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/api/conversations/${conversationId}/chat`,
        credentials: "include",
        prepareSendMessagesRequest: ({ messages }) => {
          const lastMessage = messages.at(-1);
          const textPart = lastMessage?.parts.find((p) => p.type === "text");
          return {
            body: {
              content: textPart?.text ?? "",
            },
          };
        },
      }),
    [conversationId]
  );

  return useChat({
    id: conversationId,
    transport,
  });
}
