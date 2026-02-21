"use client";

import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SANDBOX_EXECUTION_TARGET } from "@nosis/agent-runtime/execution";
import AuthGuard from "@nosis/components/auth-guard";
import AppShellGrid from "@nosis/components/app-shell-grid";
import AppSidebar from "@nosis/components/app-sidebar";
import {
  CodeWorkspaceProvider,
  useCodeWorkspace,
} from "@nosis/components/code-workspace-provider";
import type { AppShellGridHandle } from "@nosis/components/app-shell-grid";

const LEFT_SIDEBAR_EXPANDED_WIDTH = 325;
const LEFT_SIDEBAR_MIN_EXPANDED_WIDTH = 240;
const LEFT_SIDEBAR_COLLAPSED_WIDTH = 56;
const LEFT_SIDEBAR_OPEN_THRESHOLD = LEFT_SIDEBAR_COLLAPSED_WIDTH + 8;
const CODE_PATH_REGEX = /^\/code\/chat\/([0-9a-f-]+)$/i;
const CHAT_PATH_REGEX = /^\/chat\/([0-9a-f-]+)$/i;

function AppShellLayoutContent({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const gridRef = useRef<AppShellGridHandle | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const {
    conversations,
    isLoading,
    error,
    createNewConversation,
    projects,
    allWorkspaces,
    selectedProjectId,
    selectedWorkspaceId,
    isProjectsLoading,
    projectError,
    selectProject,
    selectWorkspace,
  } = useCodeWorkspace();

  const activeConversationId = useMemo(() => {
    const codeMatch = pathname.match(CODE_PATH_REGEX);
    if (codeMatch?.[1]) {
      return codeMatch[1];
    }
    const chatMatch = pathname.match(CHAT_PATH_REGEX);
    return chatMatch?.[1] ?? null;
  }, [pathname]);

  const handleCreateConversation = useCallback(
    (mode: "chat" | "code") => {
      if (mode === "chat") {
        createNewConversation({
          executionTarget: SANDBOX_EXECUTION_TARGET,
          workspaceId: null,
        })
          .then((conversation) => {
            router.push(`/chat/${conversation.id}`);
          })
          .catch(() => undefined);
        return;
      }

      if (!selectedWorkspaceId) {
        if (selectedProjectId) {
          router.push(`/code/${selectedProjectId}`);
          return;
        }
        router.push("/code");
        return;
      }

      createNewConversation({ executionTarget: SANDBOX_EXECUTION_TARGET })
        .then((conversation) => {
          router.push(`/code/chat/${conversation.id}`);
        })
        .catch(() => undefined);
    },
    [createNewConversation, router, selectedProjectId, selectedWorkspaceId]
  );

  const handleToggleSidebar = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const isExpanded =
      grid.leftWidth > LEFT_SIDEBAR_COLLAPSED_WIDTH + Number.EPSILON;

    if (isExpanded) {
      grid.setLeftWidth(LEFT_SIDEBAR_COLLAPSED_WIDTH);
      return;
    }

    grid.setLeftWidth(LEFT_SIDEBAR_EXPANDED_WIDTH);
  }, []);

  const handleLeftWidthChange = useCallback((left: number) => {
    setIsSidebarOpen(left > LEFT_SIDEBAR_OPEN_THRESHOLD);
  }, []);

  const handleSelectConversation = useCallback(
    (input: {
      conversationId: string;
      projectId: string | null;
      workspaceId: string | null;
      mode: "chat" | "code";
    }) => {
      selectProject(input.projectId);
      selectWorkspace(input.workspaceId);
      router.push(
        input.mode === "chat"
          ? `/chat/${input.conversationId}`
          : `/code/chat/${input.conversationId}`
      );
    },
    [router, selectProject, selectWorkspace]
  );

  const sidebarError = error ?? projectError;

  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      <AppShellGrid
        allowUserResize
        center={
          <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            {children}
          </div>
        }
        collapsedLeft={LEFT_SIDEBAR_COLLAPSED_WIDTH}
        initialLeft={LEFT_SIDEBAR_EXPANDED_WIDTH}
        isCollapsed={!isSidebarOpen}
        left={
          <AppSidebar
            activeConversationId={activeConversationId}
            allWorkspaces={allWorkspaces}
            conversations={conversations}
            error={sidebarError}
            isLoading={isLoading}
            isProjectsLoading={isProjectsLoading}
            isSidebarOpen={isSidebarOpen}
            onCreateConversation={handleCreateConversation}
            onSelectConversation={handleSelectConversation}
            onToggleSidebar={handleToggleSidebar}
            projects={projects}
            selectedProjectId={selectedProjectId}
          />
        }
        maxLeft={360}
        minLeft={LEFT_SIDEBAR_COLLAPSED_WIDTH}
        minOpenLeft={LEFT_SIDEBAR_MIN_EXPANDED_WIDTH}
        onLeftWidthChange={handleLeftWidthChange}
        ref={gridRef}
      />
    </div>
  );
}

export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <CodeWorkspaceProvider>
        <AppShellLayoutContent>{children}</AppShellLayoutContent>
      </CodeWorkspaceProvider>
    </AuthGuard>
  );
}
