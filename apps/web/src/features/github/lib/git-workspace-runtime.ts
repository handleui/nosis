import type {
  GithubBranch,
  GithubPullRequest,
} from "@nosis/features/github/api/worker-github-api";
import type {
  Project,
  Workspace,
} from "@nosis/features/code/api/worker-code-api";
import { ApiError } from "@nosis/features/shared/api/worker-http-client";
import {
  buildWorkspaceBranchName,
  createWorkspaceBranch,
  openPullRequest,
  parseGithubRepoUrl,
  type GithubRepoRef,
} from "@nosis/features/github/lib/git-ops";

const DEFAULT_BASE_BRANCH = "main";

export type GitWorkspaceRuntimeTarget = "web";

export type GitWorkspaceErrorCode =
  | "branch_already_exists"
  | "pull_request_already_exists"
  | "missing_github_token"
  | "not_supported"
  | "invalid_repo"
  | "invalid_state"
  | "unknown";

export class GitWorkspaceError extends Error {
  readonly code: GitWorkspaceErrorCode;

  constructor(code: GitWorkspaceErrorCode, message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "GitWorkspaceError";
    this.code = code;
  }
}

export interface GitFileChange {
  path: string;
  content: string | null;
}

export interface GitCommitResult {
  committed: boolean;
  commitSha: string | null;
}

export interface GitPushResult {
  branchName: string;
  remote: string;
}

export interface OpenWorkspacePullRequestInput {
  title: string;
  base: string;
  head?: string;
  body?: string;
}

export interface GitWorkspaceRuntime {
  readonly target: GitWorkspaceRuntimeTarget;
  ensureRepo(project: Project): Promise<GithubRepoRef>;
  ensureWorkspaceBranch(
    workspace: Workspace,
    options?: { name?: string; from?: string }
  ): Promise<GithubBranch>;
  commit(
    commitMessage: string,
    fileChanges: GitFileChange[]
  ): Promise<GitCommitResult>;
  push(): Promise<GitPushResult>;
  openPullRequest(
    input: OpenWorkspacePullRequestInput
  ): Promise<GithubPullRequest>;
}

function parseRuntimeRepo(project: Project): GithubRepoRef {
  const repo = parseGithubRepoUrl(project.repo_url);
  if (!repo) {
    throw new GitWorkspaceError(
      "invalid_repo",
      "Project repository URL must point to github.com"
    );
  }
  return repo;
}

function normalizeApiError(error: ApiError): GitWorkspaceError {
  const message = error.message.trim();
  const lower = message.toLowerCase();

  if (
    error.status === 401 &&
    lower.includes("github") &&
    lower.includes("not connected")
  ) {
    return new GitWorkspaceError("missing_github_token", message, error);
  }

  if (
    (error.status === 409 || error.status === 422) &&
    (lower.includes("branch already exists") ||
      lower.includes("reference already exists") ||
      lower.includes("branch may already exist"))
  ) {
    return new GitWorkspaceError("branch_already_exists", message, error);
  }

  if (
    (error.status === 409 || error.status === 422) &&
    (lower.includes("pull request already exists") ||
      (lower.includes("already exists") && lower.includes("pull request")))
  ) {
    return new GitWorkspaceError("pull_request_already_exists", message, error);
  }

  return new GitWorkspaceError(
    "unknown",
    message || "Git operation failed",
    error
  );
}

function normalizeError(error: unknown): GitWorkspaceError {
  if (error instanceof GitWorkspaceError) {
    return error;
  }
  if (error instanceof ApiError) {
    return normalizeApiError(error);
  }
  if (error instanceof Error) {
    return new GitWorkspaceError("unknown", error.message, error);
  }
  return new GitWorkspaceError("unknown", "Git operation failed");
}

class WorkspaceGitRuntime implements GitWorkspaceRuntime {
  readonly target: GitWorkspaceRuntimeTarget;

  private repo: GithubRepoRef | null = null;
  private branchName: string | null = null;

  constructor(target: GitWorkspaceRuntimeTarget) {
    this.target = target;
  }

  async ensureRepo(project: Project): Promise<GithubRepoRef> {
    const repo = parseRuntimeRepo(project);
    this.repo = repo;
    return await Promise.resolve(repo);
  }

  async ensureWorkspaceBranch(
    workspace: Workspace,
    options?: { name?: string; from?: string }
  ): Promise<GithubBranch> {
    const repo = this.repo;
    if (!repo) {
      throw new GitWorkspaceError(
        "invalid_state",
        "Repository must be prepared before ensuring a branch"
      );
    }

    const branchName =
      options?.name?.trim() ||
      workspace.working_branch ||
      buildWorkspaceBranchName({
        title: workspace.name,
        workspaceId: workspace.id,
        prefix: "nosis",
      });
    const from =
      options?.from?.trim() || workspace.base_branch || DEFAULT_BASE_BRANCH;

    this.branchName = branchName;

    try {
      return await createWorkspaceBranch(repo, {
        name: branchName,
        from,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  commit(
    _commitMessage: string,
    _fileChanges: GitFileChange[]
  ): Promise<GitCommitResult> {
    throw new GitWorkspaceError(
      "not_supported",
      "Local commit is unavailable in web-only mode"
    );
  }

  push(): Promise<GitPushResult> {
    throw new GitWorkspaceError(
      "not_supported",
      "Local push is unavailable in web-only mode"
    );
  }

  async openPullRequest(
    input: OpenWorkspacePullRequestInput
  ): Promise<GithubPullRequest> {
    const repo = this.repo;
    if (!repo) {
      throw new GitWorkspaceError(
        "invalid_state",
        "Repository must be prepared before opening a pull request"
      );
    }

    const head = input.head?.trim() || this.branchName;
    if (!head) {
      throw new GitWorkspaceError(
        "invalid_state",
        "A branch must be prepared before opening a pull request"
      );
    }

    try {
      const pr = await openPullRequest(repo, {
        title: input.title,
        head,
        base: input.base,
        body: input.body,
      });
      this.branchName = head;
      return pr;
    } catch (error) {
      throw normalizeError(error);
    }
  }
}

export function createGitWorkspaceRuntime(
  _workspace: Workspace | null
): GitWorkspaceRuntime {
  return new WorkspaceGitRuntime("web");
}

export function getGitWorkspaceErrorMessage(error: unknown): string {
  const normalized = normalizeError(error);

  if (normalized.code === "branch_already_exists") {
    return "Branch already exists on GitHub.";
  }
  if (normalized.code === "pull_request_already_exists") {
    return "A pull request for this branch already exists.";
  }
  if (normalized.code === "missing_github_token") {
    return "Connect your GitHub account before using GitHub controls.";
  }

  return normalized.message;
}

export function toGitWorkspaceError(error: unknown): GitWorkspaceError {
  return normalizeError(error);
}
