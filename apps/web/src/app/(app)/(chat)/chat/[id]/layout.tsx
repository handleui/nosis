import type { ReactNode } from "react";

export default function ChatConversationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
