import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApiError,
  workerFetch,
} from "@nosis/features/shared/api/worker-http-client";

describe("worker http client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("sends credentials and json content-type for body requests", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await workerFetch("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "Hello" }),
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(options.headers);

    expect(options.credentials).toBe("include");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("converts API error payloads into ApiError", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Nope" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(workerFetch("/api/conversations")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Nope",
    });
  });

  it("maps fetch abort failures to request timeout ApiError", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    fetchMock.mockRejectedValue(abortError);

    await expect(workerFetch("/api/projects")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        status: 408,
        message: "Request timed out",
      })
    );
  });
});
