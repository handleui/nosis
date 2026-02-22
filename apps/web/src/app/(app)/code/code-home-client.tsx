"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CodeChatInput from "@nosis/components/code-chat-input";
import { useCodeWorkspace } from "@nosis/components/code-workspace-provider";
import { authClient } from "@nosis/lib/auth-client";

const MAX_TITLE_LENGTH = 80;
const WHITESPACE_RE = /\s+/;

function buildConversationTitle(text: string): string {
  return text.trim().slice(0, MAX_TITLE_LENGTH);
}

export default function CodeHomeClient() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { selectedWorkspaceId, createNewConversation } = useCodeWorkspace();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = useMemo(() => {
    const name = session?.user?.name;
    if (typeof name === "string" && name.trim().length > 0) {
      const [first] = name.trim().split(WHITESPACE_RE);
      return first ?? "there";
    }
    return "there";
  }, [session?.user?.name]);

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (!selectedWorkspaceId) {
      setError("Create or select a workspace before starting a code chat.");
      return;
    }

    setError(null);
    setIsCreating(true);
    const conversation = await createNewConversation({
      title: buildConversationTitle(text),
      executionTarget: "sandbox",
      workspaceId: selectedWorkspaceId,
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to create thread");
      return null;
    });
    setIsCreating(false);

    if (conversation) {
      router.push(
        `/code/chat/${conversation.id}?q=${encodeURIComponent(trimmed)}`
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center p-4">
        <div className="flex w-full max-w-[750px] flex-col gap-8">
          <p className="font-normal text-[20px] text-black tracking-[-0.6px]">
            Hello, {firstName}
          </p>
          {error && (
            <p className="font-normal text-red-600 text-sm tracking-[-0.42px]">
              {error}
            </p>
          )}
          <CodeChatInput
            disabled={isCreating || !selectedWorkspaceId}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  );
}
