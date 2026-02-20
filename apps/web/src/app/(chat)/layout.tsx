"use client";

import { useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthGuard from "@nosis/components/auth-guard";
import ModeSwitcher from "@nosis/components/mode-switcher";
import { useConversations } from "@nosis/hooks/use-conversations";

const CHAT_PATH_REGEX = /^\/chat\/([0-9a-f-]+)$/i;

export default function ChatLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { conversations, isLoading, isCreating, error, createNewConversation } =
    useConversations();

  const activeConversationId = useMemo(() => {
    const match = pathname.match(CHAT_PATH_REGEX);
    return match?.[1] ?? null;
  }, [pathname]);

  const createAndOpenConversation = async () => {
    try {
      const conversation = await createNewConversation();
      router.push(`/chat/${conversation.id}`);
    } catch {
      // Error state is surfaced in the sidebar.
    }
  };

  const handleCreateConversationClick = () => {
    createAndOpenConversation().catch(() => undefined);
  };

  return (
    <AuthGuard>
      <div className="flex h-dvh">
        <aside className="flex w-[280px] flex-col border-subtle border-r bg-surface">
          <div className="flex h-12 items-center px-4 font-semibold">Nosis</div>
          <div className="px-4 py-2">
            <button
              className="w-full rounded-md bg-foreground px-3 py-1.5 text-center text-background text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isCreating}
              onClick={handleCreateConversationClick}
              type="button"
            >
              {isCreating ? "Creating..." : "New Chat"}
            </button>
          </div>
          <div className="scrollbar-hidden flex-1 overflow-y-auto px-2">
            <p className="px-2 py-1.5 text-muted text-sm">Conversations</p>
            {isLoading && conversations.length === 0 && (
              <p className="px-2 py-1.5 text-muted text-sm">Loading...</p>
            )}
            {error && (
              <p className="px-2 py-1.5 text-red-600 text-xs dark:text-red-400">
                {error}
              </p>
            )}
            {!isLoading && conversations.length === 0 && (
              <p className="px-2 py-1.5 text-muted text-sm">
                No conversations yet.
              </p>
            )}
            {conversations.map((conversation) => {
              const isActive = activeConversationId === conversation.id;
              return (
                <button
                  className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                    isActive
                      ? "bg-foreground text-background"
                      : "hover:bg-background"
                  }`}
                  key={conversation.id}
                  onClick={() => router.push(`/chat/${conversation.id}`)}
                  type="button"
                >
                  {conversation.title}
                </button>
              );
            })}
          </div>
          <div className="border-subtle border-t px-4 py-3">
            <ModeSwitcher />
          </div>
        </aside>
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </AuthGuard>
  );
}
