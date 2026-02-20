"use client";

import type { UIMessage } from "ai";

interface ChatMessagesProps {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error;
}

export default function ChatMessages({
  messages,
  status,
  error,
}: ChatMessagesProps) {
  return (
    <div className="flex w-full max-w-[750px] flex-col gap-8">
      {messages.map((message) => (
        <div key={message.id}>
          {message.role === "user" ? (
            <div className="w-full overflow-hidden rounded-2xl bg-surface p-4">
              <p className="whitespace-pre-wrap text-foreground text-sm leading-[1.3]">
                {message.parts
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("")}
              </p>
            </div>
          ) : (
            <div className="flex w-full flex-col gap-2 px-4">
              <p className="max-w-[450px] whitespace-pre-wrap text-foreground text-sm leading-normal">
                {message.parts
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("")}
              </p>
            </div>
          )}
        </div>
      ))}

      {(status === "submitted" || status === "streaming") && (
        <div className="flex items-center gap-2 px-4">
          <p className="text-muted text-xs">
            {status === "submitted" ? "Thinking..." : "Streaming..."}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg bg-red-50 px-4 py-3 dark:bg-red-950">
          <p className="text-red-600 text-sm dark:text-red-400">
            {error?.message ?? "Something went wrong. Please try again."}
          </p>
        </div>
      )}
    </div>
  );
}
