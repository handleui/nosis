import type { ReactNode } from "react";

export default function ChatModeLayout({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>;
}
