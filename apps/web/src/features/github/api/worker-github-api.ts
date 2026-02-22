import {
  assertBranchName,
  assertPathSegment,
  safePagination,
} from "@nosis/features/shared/api/worker-api-validation";
import { workerJson } from "@nosis/features/shared/api/worker-http-client";

export interface GithubPullRequest {
  number: number;
  title: string;
  state: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export interface GithubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface GithubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface GithubPullRequestDetail extends GithubPullRequest {
  additions: number;
  deletions: number;
  changed_files: number;
  body: string | null;
}

export interface GithubPullRequestDetailResponse {
  pr: GithubPullRequestDetail;
  check_runs: GithubCheckRun[];
}

export async function listGithubPullRequests(
  owner: string,
  repo: string,
  limit = 30,
  offset = 0
): Promise<GithubPullRequest[]> {
  assertPathSegment(owner, "repository owner");
  assertPathSegment(repo, "repository name");
  const page = safePagination(limit, offset, 100);
  return await workerJson<GithubPullRequest[]>(
    `/api/github/repos/${owner}/${repo}/pulls?limit=${page.limit}&offset=${page.offset}`
  );
}

export async function listGithubRepos(
  limit = 30,
  offset = 0,
  affiliation?: string
): Promise<GithubRepo[]> {
  const page = safePagination(limit, offset, 100);
  const affiliationQuery = affiliation
    ? `&affiliation=${encodeURIComponent(affiliation)}`
    : "";
  return await workerJson<GithubRepo[]>(
    `/api/github/repos?limit=${page.limit}&offset=${page.offset}${affiliationQuery}`
  );
}

export async function listGithubBranches(
  owner: string,
  repo: string,
  limit = 30,
  offset = 0
): Promise<GithubBranch[]> {
  assertPathSegment(owner, "repository owner");
  assertPathSegment(repo, "repository name");
  const page = safePagination(limit, offset, 100);
  return await workerJson<GithubBranch[]>(
    `/api/github/repos/${owner}/${repo}/branches?limit=${page.limit}&offset=${page.offset}`
  );
}

export async function createGithubBranch(
  owner: string,
  repo: string,
  input: {
    name: string;
    from: string;
  }
): Promise<GithubBranch> {
  assertPathSegment(owner, "repository owner");
  assertPathSegment(repo, "repository name");
  const name = assertBranchName(input.name, "branch name");
  const from = assertBranchName(input.from, "base branch");
  return await workerJson<GithubBranch>(
    `/api/github/repos/${owner}/${repo}/branches`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        from,
      }),
    }
  );
}

export async function getGithubPullRequestDetail(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GithubPullRequestDetailResponse> {
  assertPathSegment(owner, "repository owner");
  assertPathSegment(repo, "repository name");
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("Invalid pull request number");
  }
  return await workerJson<GithubPullRequestDetailResponse>(
    `/api/github/repos/${owner}/${repo}/pulls/${pullNumber}`
  );
}

export async function createGithubPullRequest(
  owner: string,
  repo: string,
  input: {
    title: string;
    head: string;
    base: string;
    body?: string;
  }
): Promise<GithubPullRequest> {
  assertPathSegment(owner, "repository owner");
  assertPathSegment(repo, "repository name");
  const title = input.title.trim();
  if (!title || title.length > 255) {
    throw new Error("Invalid pull request title");
  }
  const head = assertBranchName(input.head, "head branch");
  const base = assertBranchName(input.base, "base branch");
  const body = input.body?.trim();
  return await workerJson<GithubPullRequest>(
    `/api/github/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        head,
        base,
        body: body && body.length > 0 ? body : undefined,
      }),
    }
  );
}
