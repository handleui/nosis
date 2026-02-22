import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationChatPath,
  createConversation,
  getConversation,
  listConversations,
  listConversationMessages,
  setConversationExecutionTarget,
  setConversationWorkspace,
  toUiMessages,
} from "@nosis/features/chat/api/worker-chat-api";
import { API_URL } from "@nosis/lib/api-config";

describe("worker chat api", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("builds list query params with bounded pagination", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listConversations(
      999,
      -3,
      "sandbox",
      "11111111-2222-4333-8444-555555555555",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    );

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`${API_URL}/api/conversations?`);
    expect(url).toContain("limit=200");
    expect(url).toContain("offset=0");
    expect(url).toContain("execution_target=sandbox");
    expect(url).toContain("workspace_id=11111111-2222-4333-8444-555555555555");
    expect(url).toContain("office_id=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  it("omits nullable list filters when workspace is detached", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listConversations(50, 0, "sandbox", null, undefined);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`${API_URL}/api/conversations?`);
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=0");
    expect(url).toContain("execution_target=sandbox");
    expect(url).not.toContain("workspace_id=");
    expect(url).not.toContain("office_id=");
  });

  it("rejects invalid conversation ids for chat paths", () => {
    expect(() => conversationChatPath("bad-id")).toThrow(
      "Invalid conversation ID"
    );
  });

  it("rejects invalid create-conversation identifiers before calling fetch", async () => {
    await expect(
      createConversation({
        workspaceId: "bad-id",
      })
    ).rejects.toThrow("Invalid workspace ID");
    await expect(
      createConversation({
        officeId: "bad-id",
      })
    ).rejects.toThrow("Invalid office ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates conversations with expected payload fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "11111111-2222-4333-8444-555555555555",
          user_id: "user-1",
          title: "New",
          letta_agent_id: null,
          execution_target: "sandbox",
          office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          workspace_id: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await createConversation({
      title: "New",
      executionTarget: "sandbox",
      workspaceId: "11111111-2222-4333-8444-555555555555",
      officeId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/conversations`);
    expect(JSON.parse(String(options.body))).toEqual({
      title: "New",
      execution_target: "sandbox",
      office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      workspace_id: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("creates conversations with an explicit detached workspace", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "11111111-2222-4333-8444-555555555555",
          user_id: "user-1",
          title: "Detached",
          letta_agent_id: null,
          execution_target: "sandbox",
          office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          workspace_id: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await createConversation({
      title: "Detached",
      executionTarget: "sandbox",
      workspaceId: null,
      officeId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toEqual({
      title: "Detached",
      execution_target: "sandbox",
      office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      workspace_id: null,
    });
  });

  it("builds message list queries with bounded pagination", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listConversationMessages(
      "11111111-2222-4333-8444-555555555555",
      1000,
      -7
    );

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/conversations/11111111-2222-4333-8444-555555555555/messages?limit=500&offset=0`
    );
  });

  it("gets a conversation by validated id", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "11111111-2222-4333-8444-555555555555",
          user_id: "user-1",
          title: "Existing",
          letta_agent_id: null,
          execution_target: "sandbox",
          office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          workspace_id: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await getConversation("11111111-2222-4333-8444-555555555555");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/conversations/11111111-2222-4333-8444-555555555555`
    );
  });

  it("sends workspace updates including null values", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 204,
      })
    );

    await setConversationWorkspace(
      "11111111-2222-4333-8444-555555555555",
      null
    );

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/conversations/11111111-2222-4333-8444-555555555555/workspace`
    );
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(String(options.body))).toEqual({ workspace_id: null });
  });

  it("rejects invalid workspace ids before sending workspace updates", async () => {
    await expect(
      setConversationWorkspace("11111111-2222-4333-8444-555555555555", "bad-id")
    ).rejects.toThrow("Invalid workspace ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends execution-target updates", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 204,
      })
    );

    await setConversationExecutionTarget(
      "11111111-2222-4333-8444-555555555555",
      "sandbox"
    );

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${API_URL}/api/conversations/11111111-2222-4333-8444-555555555555/execution-target`
    );
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(String(options.body))).toEqual({
      execution_target: "sandbox",
    });
  });

  it("maps persisted message metadata into UI metadata fields", () => {
    const uiMessages = toUiMessages([
      {
        id: "m1",
        conversation_id: "11111111-2222-4333-8444-555555555555",
        role: "assistant",
        content: "done",
        model: "letta-sonnet",
        tokens_in: 120,
        tokens_out: 45,
        created_at: "2026-02-20T12:34:56.000Z",
      },
      {
        id: "m2",
        conversation_id: "11111111-2222-4333-8444-555555555555",
        role: "assistant",
        content: "no usage",
        model: null,
        tokens_in: null,
        tokens_out: null,
        created_at: "2026-02-20T12:35:56.000Z",
      },
    ]);

    expect(uiMessages).toEqual([
      {
        id: "m1",
        role: "assistant",
        metadata: {
          model: "letta-sonnet",
          tokensIn: 120,
          tokensOut: 45,
          createdAt: "2026-02-20T12:34:56.000Z",
        },
        parts: [{ type: "text", text: "done" }],
      },
      {
        id: "m2",
        role: "assistant",
        metadata: {
          createdAt: "2026-02-20T12:35:56.000Z",
        },
        parts: [{ type: "text", text: "no usage" }],
      },
    ]);
  });
});
