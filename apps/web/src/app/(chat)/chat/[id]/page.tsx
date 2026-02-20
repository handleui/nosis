"use client";

import { useParams } from "next/navigation";
import { useNosisChat } from "@nosis/hooks/use-nosis-chat";
import ChatMessages from "@nosis/components/chat-messages";
import ChatInput from "@nosis/components/chat-input";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { messages, sendMessage, status, error } = useNosisChat(id);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-end overflow-y-auto p-6">
        <ChatMessages error={error} messages={messages} status={status} />
      </div>
      <div className="border-subtle border-t p-4">
        <div className="mx-auto max-w-2xl">
          <ChatInput
            disabled={status !== "ready"}
            onSend={(text) => sendMessage({ text })}
          />
        </div>
      </div>
    </div>
  );
}
