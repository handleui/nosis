// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodeWorkspaceProvider,
  useCodeWorkspace,
} from "@nosis/components/code-workspace-provider";

vi.mock("@nosis/features/chat/hooks/use-conversations", () => ({
  useConversations: vi.fn(),
}));

vi.mock("@nosis/features/code/api/worker-code-api", () => ({
  createProject: vi.fn(),
  createWorkspace: vi.fn(),
  listProjects: vi.fn(),
  listWorkspaces: vi.fn(),
}));

import { useConversations } from "@nosis/features/chat/hooks/use-conversations";
import {
  createProject,
  createWorkspace,
  listProjects,
  listWorkspaces,
} from "@nosis/features/code/api/worker-code-api";

const mockUseConversations = vi.mocked(useConversations);
const mockCreateProject = vi.mocked(createProject);
const mockCreateWorkspace = vi.mocked(createWorkspace);
const mockListProjects = vi.mocked(listProjects);
const mockListWorkspaces = vi.mocked(listWorkspaces);

const project = {
  id: "project-1",
  user_id: "user-1",
  office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  repo_url: "https://github.com/acme/repo",
  owner: "acme",
  repo: "repo",
  default_branch: "main",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const workspace = {
  id: "workspace-1",
  user_id: "user-1",
  project_id: "project-1",
  kind: "cloud" as const,
  name: "Workspace",
  base_branch: "main",
  working_branch: "nosis/workspace-1",
  remote_url: null,
  local_path: null,
  status: "ready" as const,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  return <CodeWorkspaceProvider>{children}</CodeWorkspaceProvider>;
}

describe("useCodeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseConversations.mockReturnValue({
      conversations: [],
      isLoading: false,
      isCreating: false,
      error: null,
      refresh: vi.fn(),
      createNewConversation: vi.fn().mockResolvedValue({
        id: "conversation-1",
      }),
    } as unknown as ReturnType<typeof useConversations>);
  });

  it("loads projects/workspaces and selects defaults", async () => {
    mockListProjects.mockResolvedValueOnce([project]);
    mockListWorkspaces.mockResolvedValueOnce([workspace]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isProjectsLoading).toBe(false);
      expect(result.current.isWorkspacesLoading).toBe(false);
      expect(result.current.selectedProjectId).toBe(project.id);
      expect(result.current.selectedWorkspaceId).toBe(workspace.id);
    });

    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
    expect(result.current.activeProject?.id).toBe(project.id);
    expect(result.current.activeWorkspace?.id).toBe(workspace.id);
  });

  it("routes new conversations to sandbox workspace by default", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue({
      id: "conversation-2",
    });
    mockUseConversations.mockReturnValue({
      conversations: [],
      isLoading: false,
      isCreating: false,
      error: null,
      refresh: vi.fn(),
      createNewConversation: createConversationSpy,
    } as unknown as ReturnType<typeof useConversations>);

    mockListProjects.mockResolvedValueOnce([project]);
    mockListWorkspaces.mockResolvedValueOnce([workspace]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedWorkspaceId).toBe(workspace.id);
    });

    await act(async () => {
      await result.current.createNewConversation({ title: "hello" });
    });

    expect(createConversationSpy).toHaveBeenCalledWith({
      title: "hello",
      executionTarget: "sandbox",
      workspaceId: workspace.id,
    });
  });

  it("throws when creating a workspace without any selected project", async () => {
    mockListProjects.mockResolvedValueOnce([]);
    mockListWorkspaces.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isProjectsLoading).toBe(false);
      expect(result.current.isWorkspacesLoading).toBe(false);
    });

    await expect(result.current.createWorkspaceForProject()).rejects.toThrow(
      "Select a project first"
    );
  });

  it("creates projects and updates the active selection", async () => {
    mockListProjects.mockResolvedValueOnce([]);
    mockListWorkspaces.mockResolvedValueOnce([]);
    mockCreateProject.mockResolvedValueOnce(project);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isProjectsLoading).toBe(false);
      expect(result.current.isWorkspacesLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createProjectFromRepoUrl(
        "  https://github.com/acme/repo  "
      );
    });

    expect(mockCreateProject).toHaveBeenCalledWith({
      repoUrl: "https://github.com/acme/repo",
    });
    expect(result.current.selectedProjectId).toBe(project.id);
  });

  it("creates workspaces for the selected project", async () => {
    mockListProjects.mockResolvedValueOnce([project]);
    mockListWorkspaces.mockResolvedValueOnce([]);
    mockCreateWorkspace.mockResolvedValueOnce(workspace);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedProjectId).toBe(project.id);
    });

    await act(async () => {
      await result.current.createWorkspaceForProject();
    });

    expect(mockCreateWorkspace).toHaveBeenCalledWith({
      projectId: project.id,
      kind: "cloud",
      name: undefined,
      baseBranch: undefined,
      workingBranch: undefined,
      remoteUrl: undefined,
      localPath: undefined,
      status: undefined,
    });
    expect(result.current.selectedWorkspaceId).toBe(workspace.id);
  });

  it("captures project loading failures", async () => {
    mockListProjects.mockRejectedValueOnce(new Error("GitHub not connected"));
    mockListWorkspaces.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isProjectsLoading).toBe(false);
      expect(result.current.isWorkspacesLoading).toBe(false);
    });

    expect(result.current.projectError).toBe("GitHub not connected");
  });

  it("rejects empty repo input before calling project creation", async () => {
    mockListProjects.mockResolvedValueOnce([]);
    mockListWorkspaces.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isProjectsLoading).toBe(false);
      expect(result.current.isWorkspacesLoading).toBe(false);
    });

    await expect(
      result.current.createProjectFromRepoUrl("   ")
    ).rejects.toThrow("Repository URL is required");
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("sets workspaceError when workspace creation fails", async () => {
    mockListProjects.mockResolvedValueOnce([project]);
    mockListWorkspaces.mockResolvedValueOnce([]);
    mockCreateWorkspace.mockRejectedValueOnce(new Error("Forbidden"));

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedProjectId).toBe(project.id);
    });

    await expect(result.current.createWorkspaceForProject()).rejects.toThrow(
      "Forbidden"
    );
    await waitFor(() => {
      expect(result.current.workspaceError).toBe("Forbidden");
    });
  });

  it("uses stored project/workspace ids when still valid", async () => {
    const projectTwo = { ...project, id: "project-2" };
    const workspaceTwo = {
      ...workspace,
      id: "workspace-2",
      project_id: "project-2",
    };

    window.localStorage.setItem("nosis.code.selected_project_id", "project-2");
    window.localStorage.setItem(
      "nosis.code.selected_workspace_id",
      "workspace-2"
    );

    mockListProjects.mockResolvedValueOnce([project, projectTwo]);
    mockListWorkspaces.mockResolvedValueOnce([workspace, workspaceTwo]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isProjectsLoading).toBe(false);
      expect(result.current.isWorkspacesLoading).toBe(false);
      expect(result.current.selectedProjectId).toBe("project-2");
      expect(result.current.selectedWorkspaceId).toBe("workspace-2");
    });
  });

  it("keeps workspace detached when workspaceId is explicitly null", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue({
      id: "conversation-3",
    });
    mockUseConversations.mockReturnValue({
      conversations: [],
      isLoading: false,
      isCreating: false,
      error: null,
      refresh: vi.fn(),
      createNewConversation: createConversationSpy,
    } as unknown as ReturnType<typeof useConversations>);

    mockListProjects.mockResolvedValueOnce([project]);
    mockListWorkspaces.mockResolvedValueOnce([workspace]);

    const { result } = renderHook(() => useCodeWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedWorkspaceId).toBe(workspace.id);
    });

    await act(async () => {
      await result.current.createNewConversation({
        title: "chat mode",
        executionTarget: "sandbox",
        workspaceId: null,
      });
    });

    expect(createConversationSpy).toHaveBeenCalledWith({
      title: "chat mode",
      executionTarget: "sandbox",
      workspaceId: null,
    });
  });
});
