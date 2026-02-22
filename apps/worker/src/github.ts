import { HTTPException } from "hono/http-exception";
import type {
  GithubBranch,
  GithubCheckRun,
  GithubPR,
  GithubPRDetail,
  GithubRepo,
} from "./types";

const GITHUB_API = "https://api.github.com";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB
const GITHUB_MAX_PER_PAGE = 100; // GitHub API hard limit for per_page

// ── Error Handling ──

export type GithubUnprocessableKind =
  | "branch_already_exists"
  | "pull_request_already_exists"
  | "unknown";

function pushIfString(
  strings: string[],
  record: Record<string, unknown>,
  key: string
): void {
  const value = record[key];
  if (typeof value === "string") {
    strings.push(value);
  }
}

function entryErrorStrings(value: unknown): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  const entry = value as Record<string, unknown>;
  const strings: string[] = [];
  pushIfString(strings, entry, "message");
  pushIfString(strings, entry, "code");
  pushIfString(strings, entry, "field");
  pushIfString(strings, entry, "resource");
  return strings;
}

function extractGithubErrorStrings(body: unknown): string[] {
  if (body === null || typeof body !== "object") {
    return [];
  }

  const record = body as Record<string, unknown>;
  const strings: string[] = [];
  pushIfString(strings, record, "message");

  const rawErrors = record.errors;
  if (!Array.isArray(rawErrors)) {
    return strings;
  }

  for (const item of rawErrors) {
    for (const value of entryErrorStrings(item)) {
      strings.push(value);
    }
  }

  return strings;
}

export function classifyGithubUnprocessable(
  body: unknown,
  path: string
): GithubUnprocessableKind {
  const text = extractGithubErrorStrings(body).join(" ").toLowerCase();

  const isPullConflict =
    text.includes("pull request already exists") ||
    text.includes("a pull request already exists") ||
    (path.endsWith("/pulls") &&
      text.includes("already exists") &&
      text.includes("pull request"));
  if (isPullConflict) {
    return "pull_request_already_exists";
  }

  const isBranchConflict =
    text.includes("reference already exists") ||
    (text.includes("already_exists") &&
      (path.includes("/git/refs") || text.includes("refs/heads"))) ||
    (path.includes("/git/refs") && text.includes("already exists"));
  if (isBranchConflict) {
    return "branch_already_exists";
  }

  return "unknown";
}

function handleGithubError(status: number, body: unknown, path: string): never {
  if (status === 401) {
    throw new HTTPException(401, {
      message: "GitHub token is invalid or expired",
    });
  }
  if (status === 403) {
    throw new HTTPException(403, {
      message: "GitHub token lacks required permissions",
    });
  }
  if (status === 404) {
    throw new HTTPException(404, { message: "GitHub resource not found" });
  }
  if (status === 429) {
    throw new HTTPException(429, {
      message: "GitHub API rate limit exceeded",
    });
  }
  if (status === 422) {
    const kind = classifyGithubUnprocessable(body, path);
    if (kind === "branch_already_exists") {
      throw new HTTPException(409, {
        message: "GitHub branch already exists",
      });
    }
    if (kind === "pull_request_already_exists") {
      throw new HTTPException(409, {
        message: "GitHub pull request already exists",
      });
    }
    throw new HTTPException(409, {
      message: "GitHub rejected the request",
    });
  }
  throw new HTTPException(502, { message: "GitHub API request failed" });
}

function badUpstream(): never {
  throw new HTTPException(502, {
    message: "Unexpected response from GitHub",
  });
}

function throwResponseTooLarge(): never {
  throw new HTTPException(502, {
    message: "GitHub response exceeded size limit",
  });
}

// ── Fetch Helper ──

interface GithubFetchOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}

async function githubFetch(
  token: string,
  path: string,
  options: GithubFetchOptions = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const method = options.method ?? "GET";
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const hasBody = options.body !== undefined;
  if (hasBody) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new HTTPException(504, { message: "GitHub request timed out" });
    }
    throw new HTTPException(502, { message: "GitHub API request failed" });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errorBody: unknown = null;
    if (errorText.trim().length > 0) {
      try {
        errorBody = JSON.parse(errorText);
      } catch {
        errorBody = { message: errorText };
      }
    }
    handleGithubError(response.status, errorBody, path);
  }

  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
  ) {
    throwResponseTooLarge();
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throwResponseTooLarge();
  }

  try {
    return JSON.parse(text);
  } catch {
    badUpstream();
  }
}

// ── Response Validators ──

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function pickRepo(raw: Record<string, unknown>): GithubRepo {
  if (
    typeof raw.id !== "number" ||
    typeof raw.name !== "string" ||
    typeof raw.full_name !== "string"
  ) {
    badUpstream();
  }
  const owner = toRecord(raw.owner);
  return {
    id: raw.id,
    name: raw.name,
    full_name: raw.full_name,
    owner: {
      login: typeof owner?.login === "string" ? owner.login : "",
      avatar_url: typeof owner?.avatar_url === "string" ? owner.avatar_url : "",
    },
    private: typeof raw.private === "boolean" ? raw.private : false,
    default_branch:
      typeof raw.default_branch === "string" ? raw.default_branch : "main",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

function pickPR(raw: Record<string, unknown>): GithubPR {
  if (
    typeof raw.number !== "number" ||
    typeof raw.title !== "string" ||
    typeof raw.state !== "string"
  ) {
    badUpstream();
  }
  const head = toRecord(raw.head);
  const base = toRecord(raw.base);
  const user = toRecord(raw.user);
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    head: {
      ref: typeof head?.ref === "string" ? head.ref : "",
      sha: typeof head?.sha === "string" ? head.sha : "",
    },
    base: { ref: typeof base?.ref === "string" ? base.ref : "" },
    user: {
      login: typeof user?.login === "string" ? user.login : "",
      avatar_url: typeof user?.avatar_url === "string" ? user.avatar_url : "",
    },
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

function pickPRDetail(raw: Record<string, unknown>): GithubPRDetail {
  return {
    ...pickPR(raw),
    additions: typeof raw.additions === "number" ? raw.additions : 0,
    deletions: typeof raw.deletions === "number" ? raw.deletions : 0,
    changed_files:
      typeof raw.changed_files === "number" ? raw.changed_files : 0,
    body: typeof raw.body === "string" ? raw.body : null,
  };
}

function pickCheckRun(raw: Record<string, unknown>): GithubCheckRun {
  if (
    typeof raw.id !== "number" ||
    typeof raw.name !== "string" ||
    typeof raw.status !== "string"
  ) {
    badUpstream();
  }
  const app = toRecord(raw.app);
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
    html_url: typeof raw.html_url === "string" ? raw.html_url : "",
    app: app
      ? {
          name: typeof app.name === "string" ? app.name : "",
          slug: typeof app.slug === "string" ? app.slug : "",
        }
      : null,
    started_at: typeof raw.started_at === "string" ? raw.started_at : null,
    completed_at:
      typeof raw.completed_at === "string" ? raw.completed_at : null,
  };
}

function pickBranch(raw: Record<string, unknown>): GithubBranch {
  if (typeof raw.name !== "string") {
    badUpstream();
  }
  const commit = toRecord(raw.commit);
  return {
    name: raw.name,
    commit: { sha: typeof commit?.sha === "string" ? commit.sha : "" },
    protected: typeof raw.protected === "boolean" ? raw.protected : false,
  };
}

// ── Exported Functions ──

export interface GithubListOptions {
  perPage?: number;
  page?: number;
}

export interface CreateGithubBranchInput {
  name: string;
  from: string;
}

export interface CreateGithubPullRequestInput {
  title: string;
  head: string;
  base: string;
  body?: string;
}

export async function listUserRepos(
  token: string,
  options: GithubListOptions & { affiliation?: string } = {}
): Promise<GithubRepo[]> {
  const perPage = String(Math.min(options.perPage ?? 30, GITHUB_MAX_PER_PAGE));
  const page = String(options.page ?? 1);
  const requestedAffiliation =
    options.affiliation ?? "owner,collaborator,organization_member";

  const buildPath = (affiliation?: string) => {
    const params = new URLSearchParams();
    params.set("per_page", perPage);
    params.set("page", page);
    if (affiliation) {
      params.set("affiliation", affiliation);
    }
    params.set("sort", "updated");
    return `/user/repos?${params.toString()}`;
  };

  const listPublicOwnerRepos = async (): Promise<GithubRepo[]> => {
    let user: unknown;
    try {
      user = await githubFetch(token, "/user");
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        return [];
      }
      throw error;
    }
    const userRecord = toRecord(user);
    const login = userRecord?.login;
    if (typeof login !== "string" || login.length === 0) {
      badUpstream();
    }

    const params = new URLSearchParams();
    params.set("per_page", perPage);
    params.set("page", page);
    params.set("sort", "updated");
    let data: unknown;
    try {
      data = await githubFetch(
        token,
        `/users/${login}/repos?${params.toString()}`
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        return [];
      }
      throw error;
    }

    if (!Array.isArray(data)) {
      badUpstream();
    }
    return data.map((item) => pickRepo(toRecord(item) ?? badUpstream()));
  };

  const affiliationStrategies: Array<string | undefined> = [];
  for (const value of [
    requestedAffiliation,
    undefined,
    "owner,collaborator",
    "owner",
    "collaborator",
    "organization_member",
  ]) {
    if (!affiliationStrategies.includes(value)) {
      affiliationStrategies.push(value);
    }
  }

  const reposById = new Map<number, GithubRepo>();

  for (const affiliation of affiliationStrategies) {
    let data: unknown;
    try {
      data = await githubFetch(token, buildPath(affiliation));
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        continue;
      }
      throw error;
    }

    if (!Array.isArray(data)) {
      badUpstream();
    }

    for (const item of data) {
      const repo = pickRepo(toRecord(item) ?? badUpstream());
      reposById.set(repo.id, repo);
    }
  }

  if (reposById.size > 0) {
    return [...reposById.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
  }

  return await listPublicOwnerRepos();
}

export async function listPullRequests(
  token: string,
  owner: string,
  repo: string,
  options: GithubListOptions & { state?: string } = {}
): Promise<GithubPR[]> {
  const params = new URLSearchParams();
  params.set(
    "per_page",
    String(Math.min(options.perPage ?? 30, GITHUB_MAX_PER_PAGE))
  );
  params.set("page", String(options.page ?? 1));
  params.set("state", options.state ?? "open");
  params.set("sort", "updated");
  params.set("direction", "desc");

  const data = await githubFetch(
    token,
    `/repos/${owner}/${repo}/pulls?${params.toString()}`
  );
  if (!Array.isArray(data)) {
    badUpstream();
  }
  return data.map((item) => pickPR(toRecord(item) ?? badUpstream()));
}

export async function getPullRequest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GithubPRDetail> {
  const data = await githubFetch(
    token,
    `/repos/${owner}/${repo}/pulls/${pullNumber}`
  );
  return pickPRDetail(toRecord(data) ?? badUpstream());
}

export async function getCheckRuns(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<GithubCheckRun[]> {
  const data = await githubFetch(
    token,
    `/repos/${owner}/${repo}/commits/${ref}/check-runs`
  );
  const wrapper = toRecord(data);
  if (!wrapper) {
    badUpstream();
  }
  const runs = wrapper.check_runs;
  if (!Array.isArray(runs)) {
    badUpstream();
  }
  return runs.map((item) => pickCheckRun(toRecord(item) ?? badUpstream()));
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
  options: GithubListOptions = {}
): Promise<GithubBranch[]> {
  const params = new URLSearchParams();
  params.set(
    "per_page",
    String(Math.min(options.perPage ?? 30, GITHUB_MAX_PER_PAGE))
  );
  params.set("page", String(options.page ?? 1));

  const data = await githubFetch(
    token,
    `/repos/${owner}/${repo}/branches?${params.toString()}`
  );
  if (!Array.isArray(data)) {
    badUpstream();
  }
  return data.map((item) => pickBranch(toRecord(item) ?? badUpstream()));
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  input: CreateGithubBranchInput
): Promise<GithubBranch> {
  const source = await githubFetch(
    token,
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(input.from)}`
  );
  const sourceRecord = toRecord(source);
  const sourceCommit = toRecord(sourceRecord?.commit);
  const sourceSha = sourceCommit?.sha;
  if (typeof sourceSha !== "string" || sourceSha.length === 0) {
    badUpstream();
  }

  const created = await githubFetch(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: {
      ref: `refs/heads/${input.name}`,
      sha: sourceSha,
    },
  });

  const createdRecord = toRecord(created);
  const ref = createdRecord?.ref;
  const obj = toRecord(createdRecord?.object);
  const sha = obj?.sha;
  if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) {
    badUpstream();
  }
  if (typeof sha !== "string" || sha.length === 0) {
    badUpstream();
  }

  return {
    name: ref.slice("refs/heads/".length),
    commit: { sha },
    protected: false,
  };
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  input: CreateGithubPullRequestInput
): Promise<GithubPR> {
  const created = await githubFetch(token, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
    },
  });

  return pickPR(toRecord(created) ?? badUpstream());
}
