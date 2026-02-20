export default function ChatHome() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="font-semibold text-xl">Start a new conversation</h1>
      <p className="text-muted text-sm">
        Click <span className="font-medium text-foreground">New Chat</span> in
        the sidebar to begin.
      </p>
    </div>
  );
}
