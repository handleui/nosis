import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nosis/features/github/api/worker-github-api", () => ({
  createGithubBranch: vi.fn(),
  createGithubPullRequest: vi.fn(),
  getGithubPullRequestDetail: vi.fn(),
  listGithubBranches: vi.fn(),
  listGithubPullRequests: vi.fn(),
  listGithubRepos: vi.fn(),
}));

import {
  createGithubBranch,
  createGithubPullRequest,
  getGithubPullRequestDetail,
  listGithubBranches,
  listGithubPullRequests,
  listGithubRepos,
} from "@nosis/features/github/api/worker-github-api";
import {
  buildWorkspaceBranchName,
  createWorkspaceBranch,
  fetchGithubBranches,
  fetchGithubRepos,
  fetchPullRequestDetail,
  fetchPullRequests,
  openPullRequest,
  parseGithubRepoUrl,
} from "@nosis/features/github/lib/git-ops";

const mockListGithubRepos = vi.mocked(listGithubRepos);
const mockListGithubBranches = vi.mocked(listGithubBranches);
const mockListGithubPullRequests = vi.mocked(listGithubPullRequests);
const mockGetGithubPullRequestDetail = vi.mocked(getGithubPullRequestDetail);
const mockCreateGithubBranch = vi.mocked(createGithubBranch);
const mockCreateGithubPullRequest = vi.mocked(createGithubPullRequest);

describe("git ops helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses https github repository urls", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("parses ssh github repository urls", () => {
    expect(parseGithubRepoUrl("git@github.com:acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("returns null for non-github or malformed urls", () => {
    expect(parseGithubRepoUrl("https://gitlab.com/acme/widgets")).toBeNull();
    expect(parseGithubRepoUrl("github.com/acme/widgets")).toBeNull();
    expect(parseGithubRepoUrl("git@github.com:acme")).toBeNull();
    expect(parseGithubRepoUrl("   ")).toBeNull();
  });

  it("returns null when path does not include exactly owner/repo", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/widgets/issues")).toBe(
      null
    );
  });

  it("builds sanitized workspace branch names with prefix and id", () => {
    expect(
      buildWorkspaceBranchName({
        prefix: "Nosis Team",
        title: "Fix: auth + retries",
        workspaceId: "1234-abcd-5678-efgh",
      })
    ).toBe("nosis-team/fix-auth-retries-1234-abcd-56");
  });

  it("builds fallback workspace branch names when input is empty", () => {
    expect(buildWorkspaceBranchName({ title: "  ", workspaceId: "  " })).toBe(
      "nosis/task-task"
    );
  });

  it("delegates repository listing with default pagination", async () => {
    const repos = [
      {
        id: 1,
        name: "widgets",
        full_name: "acme/widgets",
        owner: { login: "acme", avatar_url: "https://avatars.example/acme" },
        private: false,
        default_branch: "main",
        updated_at: "2026-02-20T00:00:00.000Z",
      },
    ];
    mockListGithubRepos.mockResolvedValueOnce(repos);

    await expect(fetchGithubRepos()).resolves.toEqual(repos);
    expect(mockListGithubRepos).toHaveBeenCalledWith(30, 0, undefined);
  });

  it("delegates repository listing with custom pagination and affiliation", async () => {
    const repos = [
      {
        id: 2,
        name: "private-repo",
        full_name: "acme/private-repo",
        owner: { login: "acme", avatar_url: "https://avatars.example/acme" },
        private: true,
        default_branch: "main",
        updated_at: "2026-02-20T00:00:00.000Z",
      },
    ];
    mockListGithubRepos.mockResolvedValueOnce(repos);

    await expect(
      fetchGithubRepos({ limit: 10, offset: 5, affiliation: "owner" })
    ).resolves.toEqual(repos);
    expect(mockListGithubRepos).toHaveBeenCalledWith(10, 5, "owner");
  });

  it("delegates branch listing and pull request listing", async () => {
    const repo = { owner: "acme", repo: "widgets" };
    const branches = [
      {
        name: "main",
        commit: { sha: "abc123" },
        protected: true,
      },
    ];
    const pullRequests = [
      {
        number: 42,
        title: "Fix tests",
        state: "open",
        head: { ref: "nosis/fix-tests", sha: "abc123" },
        base: { ref: "main" },
        user: { login: "dev", avatar_url: "https://avatars.example/dev" },
        created_at: "2026-02-20T00:00:00.000Z",
        updated_at: "2026-02-20T00:00:00.000Z",
      },
    ];
    mockListGithubBranches.mockResolvedValueOnce(branches);
    mockListGithubPullRequests.mockResolvedValueOnce(pullRequests);

    await expect(fetchGithubBranches(repo)).resolves.toEqual(branches);
    expect(mockListGithubBranches).toHaveBeenCalledWith(
      "acme",
      "widgets",
      30,
      0
    );

    await expect(
      fetchPullRequests(repo, { limit: 15, offset: 3 })
    ).resolves.toEqual(pullRequests);
    expect(mockListGithubPullRequests).toHaveBeenCalledWith(
      "acme",
      "widgets",
      15,
      3
    );
  });

  it("delegates pull request detail lookup", async () => {
    const repo = { owner: "acme", repo: "widgets" };
    const detail = {
      pr: {
        number: 42,
        title: "Fix tests",
        state: "open",
        head: { ref: "nosis/fix-tests", sha: "abc123" },
        base: { ref: "main" },
        user: { login: "dev", avatar_url: "https://avatars.example/dev" },
        additions: 12,
        deletions: 4,
        changed_files: 3,
        body: null,
        created_at: "2026-02-20T00:00:00.000Z",
        updated_at: "2026-02-20T00:00:00.000Z",
      },
      check_runs: [],
    };
    mockGetGithubPullRequestDetail.mockResolvedValueOnce(detail);

    await expect(fetchPullRequestDetail(repo, 42)).resolves.toEqual(detail);
    expect(mockGetGithubPullRequestDetail).toHaveBeenCalledWith(
      "acme",
      "widgets",
      42
    );
  });

  it("delegates branch creation and pull request creation", async () => {
    const repo = { owner: "acme", repo: "widgets" };
    const branch = {
      name: "nosis/fix-tests",
      commit: { sha: "abc123" },
      protected: false,
    };
    const pullRequest = {
      number: 43,
      title: "Fix tests",
      state: "open",
      head: { ref: "nosis/fix-tests", sha: "abc123" },
      base: { ref: "main" },
      user: { login: "dev", avatar_url: "https://avatars.example/dev" },
      created_at: "2026-02-20T00:00:00.000Z",
      updated_at: "2026-02-20T00:00:00.000Z",
    };
    mockCreateGithubBranch.mockResolvedValueOnce(branch);
    mockCreateGithubPullRequest.mockResolvedValueOnce(pullRequest);

    await expect(
      createWorkspaceBranch(repo, { name: "nosis/fix-tests", from: "main" })
    ).resolves.toEqual(branch);
    expect(mockCreateGithubBranch).toHaveBeenCalledWith("acme", "widgets", {
      name: "nosis/fix-tests",
      from: "main",
    });

    await expect(
      openPullRequest(repo, {
        title: "Fix tests",
        head: "nosis/fix-tests",
        base: "main",
      })
    ).resolves.toEqual(pullRequest);
    expect(mockCreateGithubPullRequest).toHaveBeenCalledWith(
      "acme",
      "widgets",
      {
        title: "Fix tests",
        head: "nosis/fix-tests",
        base: "main",
      }
    );
  });
});
