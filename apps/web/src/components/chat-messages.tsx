"use client";

import type { UIMessage } from "ai";

interface ChatMessagesProps {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error;
}

function textFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export default function ChatMessages({
  messages,
  status,
  error,
}: ChatMessagesProps) {
  return (
    <div className="flex w-full max-w-[750px] flex-col gap-4">
      {messages.length === 0 ? (
        <div className="rounded-xl border border-subtle border-dashed bg-white p-5">
          <p className="font-medium text-[14px] text-black">New conversation</p>
          <p className="mt-1 text-[#6f6f6f] text-sm">
            Ask a question and I&apos;ll respond in real time.
          </p>
        </div>
      ) : null}

      {messages.map((message) => (
        <div
          className={`flex w-full ${
            message.role === "user" ? "justify-end" : "justify-start"
          }`}
          key={message.id}
        >
          {message.role === "user" ? (
            <div className="max-w-[85%] overflow-hidden rounded-2xl bg-black px-4 py-3 text-white">
              <p className="mb-1 font-medium text-[11px] text-white/70 uppercase">
                You
              </p>
              <p className="whitespace-pre-wrap text-sm leading-[1.35]">
                {textFromMessage(message)}
              </p>
            </div>
          ) : (
            <div className="max-w-[85%] rounded-2xl border border-subtle bg-white px-4 py-3">
              <p className="mb-1 font-medium text-[#7a7a7a] text-[11px] uppercase">
                Assistant
              </p>
              <p className="whitespace-pre-wrap text-[#171717] text-sm leading-normal">
                {textFromMessage(message)}
              </p>
            </div>
          )}
        </div>
      ))}

      {(status === "submitted" || status === "streaming") && (
        <div className="flex items-center gap-2">
          <div className="size-2 animate-pulse rounded-full bg-black/50" />
          <p className="text-[#6f6f6f] text-xs">
            {status === "submitted" ? "Thinking..." : "Streaming..."}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-red-700 text-sm">
            {error?.message ?? "Something went wrong. Please try again."}
          </p>
        </div>
      )}
    </div>
  );
}
