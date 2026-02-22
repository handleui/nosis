import { describe, expect, it } from "vitest";
import { ApiError } from "@nosis/features/shared/api/worker-http-client";
import {
  createGitWorkspaceRuntime,
  getGitWorkspaceErrorMessage,
  toGitWorkspaceError,
} from "@nosis/features/github/lib/git-workspace-runtime";

describe("git workspace runtime", () => {
  it("maps missing GitHub token errors to explicit runtime code", () => {
    const error = new ApiError(401, "GitHub account not connected");
    const normalized = toGitWorkspaceError(error);

    expect(normalized.code).toBe("missing_github_token");
    expect(getGitWorkspaceErrorMessage(error)).toBe(
      "Connect your GitHub account before using GitHub controls."
    );
  });

  it("maps branch conflict errors to explicit runtime code", () => {
    const error = new ApiError(409, "GitHub branch already exists");
    const normalized = toGitWorkspaceError(error);

    expect(normalized.code).toBe("branch_already_exists");
    expect(getGitWorkspaceErrorMessage(error)).toBe(
      "Branch already exists on GitHub."
    );
  });

  it("maps pull request conflict errors to explicit runtime code", () => {
    const error = new ApiError(409, "GitHub pull request already exists");
    const normalized = toGitWorkspaceError(error);

    expect(normalized.code).toBe("pull_request_already_exists");
    expect(getGitWorkspaceErrorMessage(error)).toBe(
      "A pull request for this branch already exists."
    );
  });

  it("creates a web runtime for cloud workspaces", () => {
    const runtime = createGitWorkspaceRuntime({
      id: "workspace-id",
      user_id: "user-id",
      project_id: "project-id",
      kind: "cloud",
      name: "Workspace",
      base_branch: "main",
      working_branch: "nosis/workspace",
      remote_url: "https://github.com/acme/repo",
      local_path: null,
      status: "ready",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    expect(runtime.target).toBe("web");
  });
});
