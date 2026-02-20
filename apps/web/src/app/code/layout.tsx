import type { ReactNode } from "react";
import AuthGuard from "@nosis/components/auth-guard";
import ModeSwitcher from "@nosis/components/mode-switcher";
import ResizableGrid from "@nosis/components/resizable-grid";

export default function CodeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-dvh overflow-hidden">
        <ResizableGrid
          center={children}
          initialLeft={240}
          initialRight={300}
          left={
            <div className="flex h-full flex-col">
              <div className="flex h-12 items-center px-4 font-semibold">
                Worktrees
              </div>
              <div className="scrollbar-hidden flex-1 overflow-y-auto px-2">
                <div className="rounded-md bg-surface px-2 py-1.5 font-medium text-sm">
                  main
                </div>
                <div className="rounded-md px-2 py-1.5 text-muted text-sm hover:bg-surface">
                  feature/auth
                </div>
                <div className="rounded-md px-2 py-1.5 text-muted text-sm hover:bg-surface">
                  fix/streaming
                </div>
              </div>
              <div className="border-subtle border-t px-4 py-3">
                <ModeSwitcher />
              </div>
            </div>
          }
          right={
            <div className="flex h-full flex-col">
              <div className="flex h-12 items-center gap-4 border-subtle border-b px-4 text-sm">
                <button className="font-medium" type="button">
                  Files
                </button>
                <button className="text-muted" type="button">
                  Changes
                </button>
                <button className="text-muted" type="button">
                  PR
                </button>
              </div>
              <div className="flex flex-1 items-center justify-center">
                <p className="text-muted text-sm">No files</p>
              </div>
            </div>
          }
        />
      </div>
    </AuthGuard>
  );
}
