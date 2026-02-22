// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversations } from "@nosis/features/chat/hooks/use-conversations";
import { ApiError } from "@nosis/features/shared/api/worker-http-client";

vi.mock("@nosis/features/chat/api/worker-chat-api", () => ({
  createConversation: vi.fn(),
  listConversations: vi.fn(),
}));

import {
  createConversation,
  listConversations,
} from "@nosis/features/chat/api/worker-chat-api";

const mockListConversations = vi.mocked(listConversations);
const mockCreateConversation = vi.mocked(createConversation);

const conversationA = {
  id: "11111111-2222-4333-8444-555555555555",
  user_id: "user-1",
  title: "Conversation A",
  letta_agent_id: null,
  execution_target: "sandbox" as const,
  office_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  workspace_id: "workspace-1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("useConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads conversations on mount and applies default filters", async () => {
    mockListConversations.mockResolvedValueOnce([conversationA]);

    const { result } = renderHook(() =>
      useConversations({
        executionTarget: "sandbox",
        workspaceId: "workspace-1",
        officeId: "office-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.conversations).toEqual([conversationA]);
    expect(mockListConversations).toHaveBeenCalledWith(
      100,
      0,
      "sandbox",
      "workspace-1",
      "office-1"
    );
  });

  it("maps server errors to a stable list message", async () => {
    mockListConversations.mockRejectedValueOnce(new ApiError(500, "boom"));

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe(
      "Could not load chats right now. Please refresh in a moment."
    );
  });

  it("defaults conversation listing to sandbox target", async () => {
    mockListConversations.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockListConversations).toHaveBeenCalledWith(
      100,
      0,
      "sandbox",
      undefined,
      undefined
    );
  });

  it("creates a conversation with defaults and deduplicates by id", async () => {
    mockListConversations.mockResolvedValueOnce([]);
    mockCreateConversation
      .mockResolvedValueOnce(conversationA)
      .mockResolvedValueOnce(conversationA);

    const { result } = renderHook(() =>
      useConversations({
        executionTarget: "sandbox",
        workspaceId: "workspace-1",
        officeId: "office-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createNewConversation({ title: "hello" });
    });

    await act(async () => {
      await result.current.createNewConversation({ title: "hello again" });
    });

    expect(mockCreateConversation).toHaveBeenNthCalledWith(1, {
      title: "hello",
      executionTarget: "sandbox",
      workspaceId: "workspace-1",
      officeId: "office-1",
    });
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0]?.id).toBe(conversationA.id);
  });

  it("preserves explicit workspaceId null when defaults are set", async () => {
    mockListConversations.mockResolvedValueOnce([]);
    mockCreateConversation.mockResolvedValueOnce(conversationA);

    const { result } = renderHook(() =>
      useConversations({
        executionTarget: "sandbox",
        workspaceId: "workspace-1",
        officeId: "office-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createNewConversation({
        title: "detached",
        workspaceId: null,
      });
    });

    expect(mockCreateConversation).toHaveBeenCalledWith({
      title: "detached",
      executionTarget: "sandbox",
      workspaceId: null,
      officeId: "office-1",
    });
  });

  it("exposes create errors and resets create state", async () => {
    mockListConversations.mockResolvedValueOnce([]);
    mockCreateConversation.mockRejectedValueOnce(new Error("Unauthorized"));

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      result.current.createNewConversation({ title: "fail please" })
    ).rejects.toThrow("Unauthorized");

    await waitFor(() => {
      expect(result.current.isCreating).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.error).toBe("Unauthorized");
    });
  });

  it("does not toggle global loading during refresh", async () => {
    let resolveRefresh: (value: (typeof conversationA)[]) => void = () =>
      undefined;
    const refreshPromise = new Promise<(typeof conversationA)[]>((resolve) => {
      resolveRefresh = resolve;
    });

    mockListConversations
      .mockResolvedValueOnce([conversationA])
      .mockReturnValueOnce(refreshPromise);

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const pendingRefresh = result.current.refresh();
    expect(result.current.isLoading).toBe(false);

    resolveRefresh([]);
    await pendingRefresh;

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("ignores stale refresh responses and keeps latest data", async () => {
    let resolveFirstRefresh: (value: (typeof conversationA)[]) => void = () =>
      undefined;
    const firstRefreshPromise = new Promise<(typeof conversationA)[]>(
      (resolve) => {
        resolveFirstRefresh = resolve;
      }
    );
    const latestConversation = {
      ...conversationA,
      id: "22222222-3333-4444-8555-666666666666",
      title: "Latest",
    };
    const staleConversation = {
      ...conversationA,
      id: "33333333-4444-4555-8666-777777777777",
      title: "Stale",
    };

    mockListConversations
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(firstRefreshPromise)
      .mockResolvedValueOnce([latestConversation]);

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const first = result.current.refresh();
    const second = result.current.refresh();
    await second;

    await waitFor(() => {
      expect(result.current.conversations).toEqual([latestConversation]);
    });

    resolveFirstRefresh([staleConversation]);
    await first;

    await waitFor(() => {
      expect(result.current.conversations).toEqual([latestConversation]);
    });
  });
});
