// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGithubControls } from "@nosis/features/github/hooks/use-github-controls";

vi.mock("@nosis/features/github/lib/git-ops", () => ({
  fetchGithubBranches: vi.fn(),
  fetchPullRequestDetail: vi.fn(),
  fetchPullRequests: vi.fn(),
  parseGithubRepoUrl: vi.fn(),
}));

vi.mock("@nosis/features/github/lib/git-workspace-runtime", () => ({
  createGitWorkspaceRuntime: vi.fn(),
  getGitWorkspaceErrorMessage: vi.fn(),
}));

import {
  fetchGithubBranches,
  fetchPullRequestDetail,
  fetchPullRequests,
  parseGithubRepoUrl,
} from "@nosis/features/github/lib/git-ops";
import {
  createGitWorkspaceRuntime,
  getGitWorkspaceErrorMessage,
} from "@nosis/features/github/lib/git-workspace-runtime";

const mockFetchGithubBranches = vi.mocked(fetchGithubBranches);
const mockFetchPullRequestDetail = vi.mocked(fetchPullRequestDetail);
const mockFetchPullRequests = vi.mocked(fetchPullRequests);
const mockParseGithubRepoUrl = vi.mocked(parseGithubRepoUrl);
const mockCreateGitWorkspaceRuntime = vi.mocked(createGitWorkspaceRuntime);
const mockGetGitWorkspaceErrorMessage = vi.mocked(getGitWorkspaceErrorMessage);

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

describe("useGithubControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseGithubRepoUrl.mockReturnValue({ owner: "acme", repo: "repo" });
    mockGetGitWorkspaceErrorMessage.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : "Unknown error"
    );
  });

  it("loads pulls and branches on mount and selects the first pull", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([
      {
        number: 17,
        title: "WIP",
        state: "open",
        head: { ref: "nosis/workspace-1", sha: "abc" },
        base: { ref: "main" },
        user: { login: "me", avatar_url: "" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockFetchGithubBranches.mockResolvedValueOnce([
      { name: "main", commit: { sha: "abc" }, protected: true },
    ]);
    mockFetchPullRequestDetail.mockResolvedValueOnce({
      pr: {
        number: 17,
        title: "WIP",
        state: "open",
        head: { ref: "nosis/workspace-1", sha: "abc" },
        base: { ref: "main" },
        user: { login: "me", avatar_url: "" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        additions: 1,
        deletions: 0,
        changed_files: 1,
        body: null,
      },
      check_runs: [],
    });

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    expect(result.current.pulls).toHaveLength(1);
    expect(result.current.selectedPullNumber).toBe(17);
    expect(result.current.branches).toHaveLength(1);
    await waitFor(() => {
      expect(mockFetchPullRequestDetail).toHaveBeenCalledWith(
        { owner: "acme", repo: "repo" },
        17
      );
    });
  });

  it("reports action error when creating a pull request without context", async () => {
    mockParseGithubRepoUrl.mockReturnValue(null);
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);

    const { result } = renderHook(() =>
      useGithubControls({ project: null, workspace: null })
    );

    await expect(
      result.current.createPullRequest({
        title: "Title",
        head: "branch",
        base: "main",
      })
    ).rejects.toThrow("Project workspace is required");

    await waitFor(() => {
      expect(result.current.actionError).toBe(
        "Select a project workspace to run Git actions."
      );
    });
  });

  it("creates branches through the runtime when context is available", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn().mockResolvedValue({ owner: "acme", repo: "repo" }),
      ensureWorkspaceBranch: vi.fn().mockResolvedValue({
        name: "feat/hooks",
        commit: { sha: "abc" },
        protected: false,
      }),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([
      {
        name: "feat/hooks",
        commit: { sha: "abc" },
        protected: false,
      },
    ]);

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createBranch({ name: "feat/hooks", from: "main" });
    });

    expect(runtime.ensureRepo).toHaveBeenCalledWith(project);
    expect(runtime.ensureWorkspaceBranch).toHaveBeenCalledWith(workspace, {
      name: "feat/hooks",
      from: "main",
    });
    await waitFor(() => {
      expect(
        result.current.branches.some((branch) => branch.name === "feat/hooks")
      ).toBe(true);
    });
  });

  it("maps pull-loading failures to hook error state", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockRejectedValueOnce(new Error("401"));
    mockFetchGithubBranches.mockResolvedValueOnce([]);
    mockGetGitWorkspaceErrorMessage.mockReturnValue("Connect GitHub first.");

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
    });

    expect(result.current.error).toBe("Connect GitHub first.");
  });

  it("validates branch input before running runtime actions", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createBranch({ name: "   ", from: "main" });
    });

    expect(result.current.actionError).toBe("Branch name is required");
    expect(runtime.ensureRepo).not.toHaveBeenCalled();
    expect(runtime.ensureWorkspaceBranch).not.toHaveBeenCalled();
  });

  it("validates pull request title before runtime calls", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await expect(
      result.current.createPullRequest({
        title: "   ",
        head: "feat/x",
        base: "main",
      })
    ).rejects.toThrow("Pull request title is required");

    await waitFor(() => {
      expect(result.current.actionError).toBe("Pull request title is required");
    });
    expect(runtime.ensureRepo).not.toHaveBeenCalled();
    expect(runtime.openPullRequest).not.toHaveBeenCalled();
  });

  it("validates head and base branch before runtime calls", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await expect(
      result.current.createPullRequest({
        title: "Valid title",
        head: "   ",
        base: "main",
      })
    ).rejects.toThrow("Head branch is required");
    await waitFor(() => {
      expect(result.current.actionError).toBe(
        "Create or enter a branch before opening a PR"
      );
    });

    await expect(
      result.current.createPullRequest({
        title: "Valid title",
        head: "feat/x",
        base: "   ",
      })
    ).rejects.toThrow("Base branch is required");
    await waitFor(() => {
      expect(result.current.actionError).toBe("Base branch is required");
    });
    expect(runtime.ensureRepo).not.toHaveBeenCalled();
    expect(runtime.openPullRequest).not.toHaveBeenCalled();
  });

  it("creates a pull request and refreshes list with runtime result", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn().mockResolvedValue({ owner: "acme", repo: "repo" }),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn().mockResolvedValue({
        number: 22,
        title: "Add tests",
        state: "open",
        head: { ref: "feat/tests", sha: "abc" },
        base: { ref: "main" },
        user: { login: "me", avatar_url: "" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        number: 22,
        title: "Add tests",
        state: "open",
        head: { ref: "feat/tests", sha: "abc" },
        base: { ref: "main" },
        user: { login: "me", avatar_url: "" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);
    mockFetchPullRequestDetail.mockResolvedValueOnce({
      pr: {
        number: 22,
        title: "Add tests",
        state: "open",
        head: { ref: "feat/tests", sha: "abc" },
        base: { ref: "main" },
        user: { login: "me", avatar_url: "" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        additions: 1,
        deletions: 0,
        changed_files: 1,
        body: null,
      },
      check_runs: [],
    });

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await expect(
      result.current.createPullRequest({
        title: "Add tests",
        head: "feat/tests",
        base: "main",
      })
    ).resolves.toBe(22);

    expect(runtime.ensureRepo).toHaveBeenCalledWith(project);
    expect(runtime.openPullRequest).toHaveBeenCalledWith({
      title: "Add tests",
      head: "feat/tests",
      base: "main",
      body: undefined,
    });

    await waitFor(() => {
      expect(result.current.selectedPullNumber).toBe(22);
      expect(result.current.pulls.some((pull) => pull.number === 22)).toBe(
        true
      );
    });
  });

  it("rolls back optimistic PR entry when runtime PR creation fails", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn().mockResolvedValue({ owner: "acme", repo: "repo" }),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn().mockRejectedValue(new Error("Forbidden")),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);
    mockGetGitWorkspaceErrorMessage.mockReturnValue("Forbidden");

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await expect(
      result.current.createPullRequest({
        title: "Add test",
        head: "feat/rollback",
        base: "main",
      })
    ).rejects.toThrow("Forbidden");

    await waitFor(() => {
      expect(result.current.actionError).toBe("Forbidden");
      expect(result.current.pulls).toHaveLength(0);
    });
  });

  it("clears action errors explicitly", async () => {
    const runtime = {
      target: "web" as const,
      ensureRepo: vi.fn(),
      ensureWorkspaceBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      openPullRequest: vi.fn(),
    };
    mockCreateGitWorkspaceRuntime.mockReturnValue(runtime);
    mockFetchPullRequests.mockResolvedValueOnce([]);
    mockFetchGithubBranches.mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useGithubControls({ project, workspace })
    );

    await waitFor(() => {
      expect(result.current.isPullsLoading).toBe(false);
      expect(result.current.isBranchesLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createBranch({ name: "feat/test", from: "   " });
    });

    expect(result.current.actionError).toBe("Base branch is required");

    act(() => {
      result.current.clearActionError();
    });

    expect(result.current.actionError).toBeNull();
  });
});
