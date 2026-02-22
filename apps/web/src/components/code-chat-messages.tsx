"use client";

import type { UIMessage } from "ai";

interface CodeChatMessagesProps {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error;
}

export default function CodeChatMessages({
  messages,
  status,
  error,
}: CodeChatMessagesProps) {
  return (
    <div className="flex w-full max-w-[750px] flex-col gap-8">
      {messages.map((message) => (
        <div key={message.id}>
          {message.role === "user" ? (
            <div className="w-full overflow-hidden rounded-[16px] bg-[#f6fbff] p-4">
              <p className="whitespace-pre-wrap font-normal text-[14px] text-black leading-[1.3] tracking-[-0.42px]">
                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6 px-4">
              <p className="max-w-[450px] whitespace-pre-wrap font-normal text-[14px] text-black leading-normal tracking-[-0.42px]">
                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("")}
              </p>
              {/* TODO: replace with real model/agent + elapsed time metadata */}
              <div className="flex items-center gap-2">
                <p className="bg-gradient-to-l from-[#e4e4e4] via-[#0080ff] via-[57.212%] to-[#e4e4e4] bg-clip-text font-normal text-transparent text-xs tracking-[-0.36px]">
                  Somelliering
                </p>
                <div className="size-1 rounded-full bg-[#d9d9d9]" />
                <p className="font-normal text-[#aaa] text-xs tracking-[-0.36px]">
                  22m 13s
                </p>
              </div>
            </div>
          )}
        </div>
      ))}

      {(status === "submitted" || status === "streaming") && (
        <div className="px-4">
          <p className="font-normal text-[#808080] text-xs tracking-[-0.36px]">
            {status === "submitted" ? "Thinking..." : "Streaming..."}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-[6px] bg-red-50 px-4 py-3 dark:bg-red-950">
          <p className="font-normal text-red-600 text-sm tracking-[-0.42px] dark:text-red-400">
            {error?.message ?? "Something went wrong. Please try again."}
          </p>
        </div>
      )}
    </div>
  );
}
