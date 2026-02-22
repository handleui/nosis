"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Attachment, SendDiagonal, Spark } from "iconoir-react";

interface CodeChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export default function CodeChatInput({
  onSend,
  disabled,
}: CodeChatInputProps) {
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
      <div className="flex w-full flex-col gap-6 overflow-hidden rounded-[4px] border border-[#f0f0f0] bg-white p-2">
        <div className="px-2 py-1">
          <textarea
            className="w-full resize-none bg-transparent font-normal text-[#111] text-sm leading-normal outline-none placeholder:text-[#aaa]"
            disabled={disabled}
            maxLength={100_000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Let’s talk..."
            rows={2}
            value={input}
          />
        </div>

        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2 px-1">
            <Spark className="size-3 text-[#808080]" />
            <p className="font-normal text-black text-sm tracking-[-0.42px]">
              Gemini 3 Flash
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Attachment className="size-3 text-[#808080]" />
            <button
              className="flex size-5 items-center justify-center overflow-hidden rounded-[4px] bg-black disabled:opacity-50"
              disabled={disabled || input.trim().length === 0}
              type="submit"
            >
              <SendDiagonal className="size-3 text-white" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
