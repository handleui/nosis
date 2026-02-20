"use client";

import { useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { conversationChatPath } from "@nosis/lib/worker-api";

export function useNosisChat(conversationId: string) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: conversationChatPath(conversationId),
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
