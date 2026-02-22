"use client";

import type { Conversation } from "@nosis/features/chat/api/worker-chat-api";

interface CodeThreadItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversationId: string) => void;
}

export default function CodeThreadItem({
  conversation,
  isActive,
  onSelect,
}: CodeThreadItemProps) {
  return (
    <button
      className={`flex h-10 w-full shrink-0 items-center overflow-hidden px-4 py-3 font-sans ${
        isActive ? "bg-[#f6fbff]" : "hover:bg-[#f8f8f8]"
      }`}
      onClick={() => onSelect(conversation.id)}
      type="button"
    >
      <p
        className={`truncate text-sm leading-normal ${
          isActive ? "text-[#0080ff]" : "text-black"
        }`}
      >
        {conversation.title}
      </p>
    </button>
  );
}
