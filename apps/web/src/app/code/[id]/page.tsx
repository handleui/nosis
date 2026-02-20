"use client";

import { useParams } from "next/navigation";
import { useNosisChat } from "@nosis/hooks/use-nosis-chat";
import ChatMessages from "@nosis/components/chat-messages";
import ChatInput from "@nosis/components/chat-input";

export default function CodeSessionPage() {
  const { id } = useParams<{ id: string }>();
  const { messages, sendMessage, status, error } = useNosisChat(id);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Chat area */}
      <div className="scrollbar-hidden flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end gap-8 overflow-y-auto overscroll-none p-4">
        <ChatMessages error={error} messages={messages} status={status} />
      </div>

      {/* Input */}
      <div className="w-full max-w-[750px] self-center px-4 pb-4">
        <ChatInput
          disabled={status !== "ready"}
          onSend={(text) => sendMessage({ text })}
        />
      </div>
    </div>
  );
}
