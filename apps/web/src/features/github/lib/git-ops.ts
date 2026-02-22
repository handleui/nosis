import {
  createGithubBranch,
  createGithubPullRequest,
  getGithubPullRequestDetail,
  listGithubBranches,
  listGithubPullRequests,
  listGithubRepos,
  type GithubBranch,
  type GithubPullRequest,
  type GithubPullRequestDetailResponse,
  type GithubRepo,
} from "@nosis/features/github/api/worker-github-api";

const BRANCH_SEGMENT_RE = /[^a-zA-Z0-9._-]+/g;
const DASH_REPEAT_RE = /-+/g;
const DASH_TRIM_RE = /^-+|-+$/g;
const GIT_SUFFIX_RE = /\.git$/i;
const PATH_TRIM_SLASH_RE = /^\/+|\/+$/g;

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface BuildBranchNameInput {
  title?: string;
  workspaceId?: string;
  prefix?: string;
}

function sanitizeBranchSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(BRANCH_SEGMENT_RE, "-")
    .replace(DASH_REPEAT_RE, "-")
    .replace(DASH_TRIM_RE, "");

  return normalized || "task";
}

export function parseGithubRepoUrl(repoUrl: string): GithubRepoRef | null {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("git@github.com:")) {
    const path = trimmed
      .slice("git@github.com:".length)
      .replace(GIT_SUFFIX_RE, "");
    const [owner, repo] = path.split("/");
    if (!(owner && repo)) {
      return null;
    }
    return { owner, repo };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const parts = parsed.pathname.replace(PATH_TRIM_SLASH_RE, "").split("/");
    if (parts.length !== 2) {
      return null;
    }
    const [owner, rawRepo] = parts;
    const repo = rawRepo.replace(GIT_SUFFIX_RE, "");
    if (!(owner && repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

export function buildWorkspaceBranchName(input: BuildBranchNameInput): string {
  const prefix = sanitizeBranchSegment(input.prefix ?? "nosis");
  const titlePart = sanitizeBranchSegment(input.title ?? "workspace").slice(
    0,
    32
  );
  const workspacePart = sanitizeBranchSegment(input.workspaceId ?? "").slice(
    0,
    12
  );

  if (workspacePart) {
    return `${prefix}/${titlePart}-${workspacePart}`;
  }

  return `${prefix}/${titlePart}`;
}

export async function fetchGithubRepos(options?: {
  limit?: number;
  offset?: number;
  affiliation?: string;
}): Promise<GithubRepo[]> {
  return await listGithubRepos(
    options?.limit ?? 30,
    options?.offset ?? 0,
    options?.affiliation
  );
}

export async function fetchGithubBranches(
  repo: GithubRepoRef,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<GithubBranch[]> {
  return await listGithubBranches(
    repo.owner,
    repo.repo,
    options?.limit ?? 30,
    options?.offset ?? 0
  );
}

export async function fetchPullRequests(
  repo: GithubRepoRef,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<GithubPullRequest[]> {
  return await listGithubPullRequests(
    repo.owner,
    repo.repo,
    options?.limit ?? 30,
    options?.offset ?? 0
  );
}

export async function fetchPullRequestDetail(
  repo: GithubRepoRef,
  pullNumber: number
): Promise<GithubPullRequestDetailResponse> {
  return await getGithubPullRequestDetail(repo.owner, repo.repo, pullNumber);
}

export async function createWorkspaceBranch(
  repo: GithubRepoRef,
  input: {
    name: string;
    from: string;
  }
): Promise<GithubBranch> {
  return await createGithubBranch(repo.owner, repo.repo, input);
}

export async function openPullRequest(
  repo: GithubRepoRef,
  input: {
    title: string;
    head: string;
    base: string;
    body?: string;
  }
): Promise<GithubPullRequest> {
  return await createGithubPullRequest(repo.owner, repo.repo, input);
}
