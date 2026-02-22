import assert from "node:assert/strict";
import test from "node:test";
import { classifyGithubUnprocessable, listUserRepos } from "../src/github";

test("classifies branch-already-exists conflict payloads", () => {
  const kind = classifyGithubUnprocessable(
    {
      message: "Validation Failed",
      errors: [{ code: "already_exists", field: "ref" }],
    },
    "/repos/acme/repo/git/refs"
  );

  assert.equal(kind, "branch_already_exists");
});

test("classifies pull-request-already-exists payloads", () => {
  const kind = classifyGithubUnprocessable(
    {
      message: "A pull request already exists for acme:feature-branch.",
    },
    "/repos/acme/repo/pulls"
  );

  assert.equal(kind, "pull_request_already_exists");
});

test("returns unknown for unrelated validation payloads", () => {
  const kind = classifyGithubUnprocessable(
    {
      message: "Validation Failed",
      errors: [{ code: "custom", message: "something else" }],
    },
    "/repos/acme/repo/pulls"
  );

  assert.equal(kind, "unknown");
});

test("falls back to public owner repos when /user/repos returns 200 empty lists", async () => {
  const originalFetch = globalThis.fetch;
  const repoPayload = [
    {
      id: 101,
      name: "montreal-v1",
      full_name: "rodrigo/montreal-v1",
      owner: { login: "rodrigo", avatar_url: "https://example.com/avatar.png" },
      private: false,
      default_branch: "main",
      updated_at: "2026-02-21T10:00:00Z",
    },
  ];

  globalThis.fetch = ((input: RequestInfo | URL) => {
    let rawUrl: string;
    if (typeof input === "string") {
      rawUrl = input;
    } else if (input instanceof URL) {
      rawUrl = input.toString();
    } else {
      rawUrl = input.url;
    }
    const url = new URL(rawUrl);

    if (url.pathname === "/user/repos") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/user") {
      return new Response(JSON.stringify({ login: "rodrigo" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/users/rodrigo/repos") {
      return new Response(JSON.stringify(repoPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected GitHub path: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const repos = await listUserRepos("token", {
      perPage: 30,
      page: 1,
      affiliation: "owner,collaborator,organization_member",
    });

    assert.equal(repos.length, 1);
    assert.equal(repos[0]?.full_name, "rodrigo/montreal-v1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
