"use client";

import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { GitBranch, NavArrowLeft } from "iconoir-react";
import { useParams } from "next/navigation";
import GithubControlsPanel from "@nosis/components/github-controls-panel";
import { useCodeWorkspace } from "@nosis/components/code-workspace-provider";
import ResizableGrid, {
  type ResizableGridHandle,
} from "@nosis/components/resizable-grid";

const PR_PANEL_WIDTH = 425;

export default function CodeConversationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const { conversations, projects, allWorkspaces } = useCodeWorkspace();
  const prGridRef = useRef<ResizableGridHandle | null>(null);
  const [isPrPanelOpen, setIsPrPanelOpen] = useState(true);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === id),
    [conversations, id]
  );

  const activeWorkspace = useMemo(() => {
    const workspaceId = activeConversation?.workspace_id;
    if (!workspaceId) {
      return null;
    }
    return (
      allWorkspaces.find((workspace) => workspace.id === workspaceId) ?? null
    );
  }, [activeConversation?.workspace_id, allWorkspaces]);

  const activeProject = useMemo(() => {
    const projectId = activeWorkspace?.project_id;
    if (!projectId) {
      return null;
    }
    return projects.find((project) => project.id === projectId) ?? null;
  }, [activeWorkspace?.project_id, projects]);

  let branchLabel = "No workspace";
  if (activeConversation?.workspace_id) {
    branchLabel = "Workspace unavailable";
  }
  if (activeWorkspace?.working_branch) {
    branchLabel = activeWorkspace.working_branch;
  }

  const togglePrPanel = useCallback(() => {
    const grid = prGridRef.current;
    if (!grid) {
      return;
    }
    const isCurrentlyOpen = grid.getWidths().right > 0;
    if (isCurrentlyOpen) {
      grid.setWidths(0, 0, 180);
      return;
    }
    grid.setWidths(0, PR_PANEL_WIDTH, 180);
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-10 items-center gap-3 border-[#f1f1f2] border-b px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="truncate font-normal text-[13px] text-black tracking-[-0.39px]">
            {activeConversation?.title ?? "Conversation"}
          </p>
          <div className="flex items-center gap-2">
            <GitBranch className="size-3 text-[#808080]" />
            {/* TODO: replace with real branch from conversation metadata */}
            <p className="font-normal text-[#808080] text-[13px] leading-[1.2] tracking-[-0.39px]">
              {branchLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <p className="font-normal text-[#808080] text-xs tracking-[-0.36px]">
            GitHub
          </p>

          <button
            className="flex size-6 items-center justify-center rounded-[4px] hover:bg-[#f6f6f6]"
            onClick={togglePrPanel}
            type="button"
          >
            <NavArrowLeft
              className={`size-3 transition-transform ${
                isPrPanelOpen ? "" : "rotate-180"
              } text-[#808080]`}
            />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ResizableGrid
          allowLeftResize={false}
          allowRightResize
          allowUserResize
          center={
            <div className="h-full min-h-0 min-w-0 overflow-hidden">
              {children}
            </div>
          }
          initialLeft={0}
          initialRight={PR_PANEL_WIDTH}
          left={null}
          onWidthsChange={({ right }) => setIsPrPanelOpen(right > 0)}
          ref={prGridRef}
          right={
            <GithubControlsPanel
              project={activeProject}
              workspace={activeWorkspace}
            />
          }
        />
      </div>
    </div>
  );
}
