"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import ChatInput from "@nosis/components/chat-input";
import ChatMessages from "@nosis/components/chat-messages";
import { useNosisChat } from "@nosis/features/chat/hooks/use-nosis-chat";

function clearSeedQuery(): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has("q")) {
    return;
  }
  url.searchParams.delete("q");
  const query = url.searchParams.toString();
  const nextPath = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  window.history.replaceState(window.history.state, "", nextPath);
}

export default function ConversationPageClient() {
  const { id } = useParams<{ id: string }>();
  const seededMessageRef = useRef<string | null>(null);
  const {
    messages,
    sendMessage,
    status,
    error,
    isHydratingHistory,
    historyError,
  } = useNosisChat(id);

  const effectiveStatus = isHydratingHistory ? "submitted" : status;
  const effectiveError = historyError ?? error;
  const pendingSeedMessage = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
  }, []);

  useEffect(() => {
    if (pendingSeedMessage.length === 0) {
      return;
    }
    if (isHydratingHistory || status !== "ready") {
      return;
    }

    const seedKey = `${id}:${pendingSeedMessage}`;
    if (seededMessageRef.current === seedKey) {
      return;
    }

    if (messages.length > 0) {
      seededMessageRef.current = seedKey;
      clearSeedQuery();
      return;
    }

    seededMessageRef.current = seedKey;
    sendMessage({ text: pendingSeedMessage });
    clearSeedQuery();
  }, [
    id,
    isHydratingHistory,
    messages.length,
    pendingSeedMessage,
    sendMessage,
    status,
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-end overflow-y-auto p-6">
        <ChatMessages
          error={effectiveError}
          messages={messages}
          status={effectiveStatus}
        />
      </div>
      <div className="border-subtle border-t p-4">
        <div className="mx-auto max-w-2xl">
          <ChatInput
            disabled={status !== "ready" || isHydratingHistory}
            onSend={(text) => sendMessage({ text })}
          />
        </div>
      </div>
    </div>
  );
}
