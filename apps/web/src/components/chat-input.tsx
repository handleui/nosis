"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
  submitLabel?: string;
}

export default function ChatInput({
  onSend,
  disabled,
  placeholder = "Let's talk...",
  submitLabel = "Send",
}: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex w-full flex-col gap-3 overflow-hidden rounded-lg border border-subtle bg-white p-2">
        <textarea
          className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted"
          disabled={disabled}
          maxLength={100_000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          value={input}
        />
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="text-[#8a8a8a] text-xs">
            Enter to send, Shift+Enter for newline
          </p>
          <button
            className="rounded bg-black px-3 py-1.5 font-medium text-white text-xs disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || input.trim().length === 0}
            type="submit"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
