"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CodeThreadItem from "@nosis/components/code-thread-item";
import { useCodeWorkspace } from "@nosis/components/code-workspace-provider";

export default function CodeProjectPageClient() {
  const { project: projectId } = useParams<{ project: string }>();
  const router = useRouter();
  const {
    projects,
    allWorkspaces,
    conversations,
    selectedWorkspaceId,
    isLoading,
    isCreating,
    isProjectsLoading,
    isWorkspacesLoading,
    selectProject,
    selectWorkspace,
    createNewConversation,
  } = useCodeWorkspace();
  const [actionError, setActionError] = useState<string | null>(null);

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projectId, projects]
  );

  const legacyConversation = useMemo(
    () =>
      conversations.find(
        (conversation) =>
          conversation.id === projectId &&
          conversation.execution_target === "sandbox"
      ) ?? null,
    [conversations, projectId]
  );

  useEffect(() => {
    if (!project) {
      return;
    }
    selectProject(project.id);
  }, [project, selectProject]);

  useEffect(() => {
    if (project || isProjectsLoading || !legacyConversation) {
      return;
    }
    selectWorkspace(legacyConversation.workspace_id ?? null);
    router.replace(`/code/chat/${legacyConversation.id}`);
  }, [isProjectsLoading, legacyConversation, project, router, selectWorkspace]);

  const projectWorkspaces = useMemo(
    () =>
      allWorkspaces.filter((workspace) => workspace.project_id === projectId),
    [allWorkspaces, projectId]
  );

  const workspaceById = useMemo(
    () =>
      new Map(projectWorkspaces.map((workspace) => [workspace.id, workspace])),
    [projectWorkspaces]
  );

  const projectConversations = useMemo(() => {
    const rows = conversations.filter((conversation) => {
      if (conversation.execution_target !== "sandbox") {
        return false;
      }
      if (!conversation.workspace_id) {
        return false;
      }
      return workspaceById.has(conversation.workspace_id);
    });

    rows.sort(
      (left, right) =>
        Date.parse(right.updated_at || right.created_at) -
        Date.parse(left.updated_at || left.created_at)
    );

    return rows;
  }, [conversations, workspaceById]);

  const preferredWorkspaceId = useMemo(() => {
    if (selectedWorkspaceId && workspaceById.has(selectedWorkspaceId)) {
      return selectedWorkspaceId;
    }
    return projectWorkspaces[0]?.id ?? null;
  }, [projectWorkspaces, selectedWorkspaceId, workspaceById]);

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      const conversation = projectConversations.find(
        (row) => row.id === conversationId
      );
      if (!conversation) {
        return;
      }
      selectWorkspace(conversation.workspace_id ?? null);
      router.push(`/code/chat/${conversation.id}`);
    },
    [projectConversations, router, selectWorkspace]
  );

  const handleCreateConversation = useCallback(async () => {
    if (!preferredWorkspaceId) {
      setActionError(
        "Create a workspace for this project before starting a thread."
      );
      return;
    }

    setActionError(null);
    const conversation = await createNewConversation({
      executionTarget: "sandbox",
      workspaceId: preferredWorkspaceId,
    }).catch((error) => {
      setActionError(
        error instanceof Error ? error.message : "Failed to create thread"
      );
      return null;
    });

    if (!conversation) {
      return;
    }

    selectWorkspace(preferredWorkspaceId);
    router.push(`/code/chat/${conversation.id}`);
  }, [createNewConversation, preferredWorkspaceId, router, selectWorkspace]);

  if (!(isProjectsLoading || isLoading || project || legacyConversation)) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white p-6">
        <p className="font-normal text-black text-lg tracking-[-0.54px]">
          Project not found
        </p>
        <p className="mt-2 font-normal text-[#808080] text-sm tracking-[-0.42px]">
          Select a project from the sidebar to continue.
        </p>
      </div>
    );
  }

  const projectLabel = project ? `${project.owner}/${project.repo}` : "Project";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-[#f1f1f2] border-b px-6 py-4">
        <div className="min-w-0">
          <p className="truncate font-normal text-[20px] text-black tracking-[-0.6px]">
            {projectLabel}
          </p>
          <p className="mt-1 font-normal text-[#808080] text-xs tracking-[-0.36px]">
            {projectConversations.length} thread
            {projectConversations.length === 1 ? "" : "s"}
          </p>
        </div>

        <button
          className="h-9 rounded border border-[#dadadd] px-3 font-normal text-sm hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isCreating || !preferredWorkspaceId}
          onClick={() => {
            handleCreateConversation().catch(() => undefined);
          }}
          type="button"
        >
          {isCreating ? "Creating..." : "New thread"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {isLoading || isWorkspacesLoading || isProjectsLoading ? (
          <p className="px-6 py-3 text-[#808080] text-sm tracking-[-0.42px]">
            Loading threads...
          </p>
        ) : null}

        {!(isLoading || isWorkspacesLoading) &&
        projectConversations.length === 0 ? (
          <p className="px-6 py-3 text-[#808080] text-sm tracking-[-0.42px]">
            No code threads for this project yet.
          </p>
        ) : null}

        {projectConversations.map((conversation) => {
          const workspaceName = conversation.workspace_id
            ? (workspaceById.get(conversation.workspace_id)?.name ??
              "Unknown workspace")
            : "No workspace";

          return (
            <div className="border-[#f7f7f7] border-b" key={conversation.id}>
              <CodeThreadItem
                conversation={conversation}
                isActive={false}
                onSelect={handleOpenConversation}
              />
              <p className="px-4 pb-3 text-[#808080] text-xs tracking-[-0.36px]">
                {workspaceName}
              </p>
            </div>
          );
        })}

        {actionError ? (
          <p className="px-6 py-3 font-normal text-red-600 text-sm tracking-[-0.42px]">
            {actionError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
