import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGithubBranch,
  createGithubPullRequest,
  getGithubPullRequestDetail,
  listGithubBranches,
  listGithubPullRequests,
  listGithubRepos,
} from "@nosis/features/github/api/worker-github-api";
import { API_URL } from "@nosis/lib/api-config";

describe("worker github api", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("trims title/body and omits empty PR body", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 12,
          title: "Fix tests",
          state: "open",
          head: { ref: "feat/tests", sha: "abc" },
          base: { ref: "main" },
          user: { login: "me", avatar_url: "" },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await createGithubPullRequest("acme", "repo", {
      title: "  Fix tests  ",
      head: "feat/tests",
      base: "main",
      body: "   ",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;

    expect(body.title).toBe("Fix tests");
    expect(body.head).toBe("feat/tests");
    expect(body.base).toBe("main");
    expect("body" in body).toBe(false);
  });

  it("includes a trimmed PR body when provided", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 13,
          title: "Add body",
          state: "open",
          head: { ref: "feat/body", sha: "abc" },
          base: { ref: "main" },
          user: { login: "me", avatar_url: "" },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await createGithubPullRequest("acme", "repo", {
      title: "Add body",
      head: "feat/body",
      base: "main",
      body: "  Includes test plan  ",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.body).toBe("Includes test plan");
  });

  it("rejects invalid pull request input before request", async () => {
    await expect(
      createGithubPullRequest("acme", "repo", {
        title: "   ",
        head: "feat/tests",
        base: "main",
      })
    ).rejects.toThrow("Invalid pull request title");
    await expect(
      createGithubPullRequest("acme", "repo", {
        title: "x".repeat(256),
        head: "feat/tests",
        base: "main",
      })
    ).rejects.toThrow("Invalid pull request title");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-positive pull request numbers before request", async () => {
    await expect(getGithubPullRequestDetail("acme", "repo", 0)).rejects.toThrow(
      "Invalid pull request number"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds pull request detail path for valid input", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          pr: {
            number: 12,
            title: "Fix tests",
            state: "open",
            head: { ref: "feat/tests", sha: "abc" },
            base: { ref: "main" },
            user: { login: "me", avatar_url: "" },
            additions: 10,
            deletions: 2,
            changed_files: 3,
            body: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          check_runs: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await getGithubPullRequestDetail("acme", "repo", 12);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/github/repos/acme/repo/pulls/12`);
  });

  it("builds repo listing query with bounded pagination and affiliation", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listGithubRepos(999, -10, "owner,collaborator");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/github/repos?limit=100&offset=0&affiliation=owner%2Ccollaborator`
    );
  });

  it("builds pull listing query with bounded pagination", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listGithubPullRequests("acme", "repo", 300, -5);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/github/repos/acme/repo/pulls?limit=100&offset=0`
    );
  });

  it("rejects invalid owner path segments before request", async () => {
    await expect(listGithubPullRequests("acme/team", "repo")).rejects.toThrow(
      "Invalid repository owner"
    );
    await expect(listGithubBranches("acme/team", "repo")).rejects.toThrow(
      "Invalid repository owner"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds branch listing query with bounded pagination", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listGithubBranches("acme", "repo", 300, -5);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/github/repos/acme/repo/branches?limit=100&offset=0`
    );
  });

  it("trims branch inputs before create branch request", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "feat/new-branch",
          commit: { sha: "abc" },
          protected: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await createGithubBranch("acme", "repo", {
      name: " feat/new-branch ",
      from: " main ",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toEqual({
      name: "feat/new-branch",
      from: "main",
    });
  });

  it("rejects invalid branch names before create branch request", async () => {
    await expect(
      createGithubBranch("acme", "repo", {
        name: "bad branch",
        from: "main",
      })
    ).rejects.toThrow("Invalid branch name");
    await expect(
      createGithubBranch("acme", "repo", {
        name: "feat/new",
        from: "bad branch",
      })
    ).rejects.toThrow("Invalid base branch");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
