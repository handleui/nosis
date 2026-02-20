import type { ReactNode } from "react";
import AuthGuard from "@nosis/components/auth-guard";
import ModeSwitcher from "@nosis/components/mode-switcher";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-dvh">
        <aside className="flex w-[280px] flex-col border-subtle border-r bg-surface">
          <div className="flex h-12 items-center px-4 font-semibold">Nosis</div>
          <div className="px-4 py-2">
            <div className="rounded-md bg-foreground px-3 py-1.5 text-center text-background text-sm">
              New Chat
            </div>
          </div>
          <div className="scrollbar-hidden flex-1 overflow-y-auto px-2">
            <p className="px-2 py-1.5 text-muted text-sm">Conversations</p>
            <div className="rounded-md px-2 py-1.5 text-sm hover:bg-surface">
              Yesterday's conversation
            </div>
            <div className="rounded-md px-2 py-1.5 text-sm hover:bg-surface">
              API integration plan
            </div>
            <div className="rounded-md px-2 py-1.5 text-sm hover:bg-surface">
              Debug session
            </div>
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
