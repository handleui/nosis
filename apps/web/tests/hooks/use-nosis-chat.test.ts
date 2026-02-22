// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNosisChat } from "@nosis/features/chat/hooks/use-nosis-chat";
import { ApiError } from "@nosis/features/shared/api/worker-http-client";

const useChatMock = vi.fn();
const transportCtorMock = vi.fn();

vi.mock("@ai-sdk/react", () => ({
  useChat: (...args: unknown[]) => useChatMock(...args),
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class MockDefaultChatTransport {
    constructor(options: unknown) {
      transportCtorMock(options);
    }
  },
}));

vi.mock("@nosis/features/chat/api/worker-chat-api", () => ({
  conversationChatPath: vi.fn(),
  listConversationMessages: vi.fn(),
  toUiMessages: vi.fn(),
}));

import {
  conversationChatPath,
  listConversationMessages,
  toUiMessages,
} from "@nosis/features/chat/api/worker-chat-api";

const mockConversationChatPath = vi.mocked(conversationChatPath);
const mockListConversationMessages = vi.mocked(listConversationMessages);
const mockToUiMessages = vi.mocked(toUiMessages);

describe("useNosisChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockConversationChatPath.mockImplementation((id: string) => `/chat/${id}`);
  });

  it("hydrates chat history and clears loading state", async () => {
    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages.mockResolvedValueOnce([
      {
        id: "m1",
        conversation_id: "c1",
        role: "assistant",
        content: "hello",
        model: null,
        tokens_in: null,
        tokens_out: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockToUiMessages.mockReturnValueOnce([
      { id: "m1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ]);

    const { result } = renderHook(() => useNosisChat("c1"));

    await waitFor(() => {
      expect(result.current.isHydratingHistory).toBe(false);
    });

    expect(setMessages).toHaveBeenNthCalledWith(1, []);
    expect(setMessages).toHaveBeenNthCalledWith(2, [
      { id: "m1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ]);
    expect(result.current.historyError).toBeUndefined();
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 5xx history failure", async () => {
    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages
      .mockRejectedValueOnce(new ApiError(500, "retry me"))
      .mockResolvedValueOnce([]);
    mockToUiMessages.mockReturnValueOnce([]);

    const { result } = renderHook(() => useNosisChat("c2"));

    await waitFor(() => {
      expect(mockListConversationMessages).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.isHydratingHistory).toBe(false);
    });

    expect(result.current.historyError).toBeUndefined();
  });

  it("surfaces non-retryable history failures", async () => {
    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages.mockRejectedValueOnce(
      new Error("Failed to load chat history")
    );

    const { result } = renderHook(() => useNosisChat("c3"));

    await waitFor(() => {
      expect(result.current.isHydratingHistory).toBe(false);
    });

    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);
    expect(result.current.historyError?.message).toBe(
      "Failed to load chat history"
    );
  });

  it("maps unknown history failures to a stable fallback error", async () => {
    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages.mockRejectedValueOnce("not-an-error-object");

    const { result } = renderHook(() => useNosisChat("c3b"));

    await waitFor(() => {
      expect(result.current.isHydratingHistory).toBe(false);
    });

    expect(result.current.historyError?.message).toBe(
      "Failed to load chat history"
    );
  });

  it("ignores late history results after unmount", async () => {
    let resolveHistory: (
      value: Array<{
        id: string;
        conversation_id: string;
        role: "user" | "assistant" | "system";
        content: string;
        model: string | null;
        tokens_in: number | null;
        tokens_out: number | null;
        created_at: string;
      }>
    ) => void = () => undefined;
    const pendingHistory = new Promise<
      Array<{
        id: string;
        conversation_id: string;
        role: "user" | "assistant" | "system";
        content: string;
        model: string | null;
        tokens_in: number | null;
        tokens_out: number | null;
        created_at: string;
      }>
    >((resolve) => {
      resolveHistory = resolve;
    });

    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages.mockReturnValueOnce(pendingHistory);
    mockToUiMessages.mockReturnValueOnce([
      {
        id: "m-late",
        role: "assistant",
        parts: [{ type: "text", text: "late" }],
      },
    ]);

    const { unmount } = renderHook(() => useNosisChat("c-late"));
    unmount();

    resolveHistory([
      {
        id: "m-late",
        conversation_id: "c-late",
        role: "assistant",
        content: "late",
        model: null,
        tokens_in: null,
        tokens_out: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(setMessages).toHaveBeenCalledWith([]);
  });

  it("sends full chat payloads (messages, trigger, skill_ids) to the transport", () => {
    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages.mockResolvedValueOnce([]);
    mockToUiMessages.mockReturnValueOnce([]);

    renderHook(() => useNosisChat("c4"));

    const [transportOptions] = transportCtorMock.mock.calls[0] as [
      {
        prepareSendMessagesRequest: (options: {
          id: string;
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            parts: Array<{ type: string; text?: string }>;
          }>;
          requestMetadata: unknown;
          body: Record<string, unknown> | undefined;
          credentials: RequestCredentials | undefined;
          headers: HeadersInit | undefined;
          api: string;
          trigger: "submit-message" | "regenerate-message";
          messageId: string | undefined;
        }) => { body: Record<string, unknown> };
      },
    ];

    const payload = transportOptions.prepareSendMessagesRequest({
      id: "c4",
      api: "/chat/c4",
      body: undefined,
      credentials: "include",
      headers: undefined,
      trigger: "submit-message",
      messageId: "m-user",
      requestMetadata: {
        skillIds: ["tool-first", "code-assistant", " "],
      },
      messages: [
        {
          id: "m-system",
          role: "system",
          parts: [{ type: "text", text: "you are helpful" }],
        },
        {
          id: "m-user",
          role: "user",
          parts: [{ type: "text", text: "Review this code" }],
        },
      ],
    });

    expect(payload).toEqual({
      body: {
        messages: [
          {
            id: "m-system",
            role: "system",
            parts: [{ type: "text", text: "you are helpful" }],
          },
          {
            id: "m-user",
            role: "user",
            parts: [{ type: "text", text: "Review this code" }],
          },
        ],
        trigger: "submit-message",
        message_id: "m-user",
        skill_ids: ["tool-first", "code-assistant"],
        content: "Review this code",
      },
    });
  });

  it("omits skill_ids when request metadata does not include skillIds", () => {
    const setMessages = vi.fn();
    useChatMock.mockReturnValue({
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      setMessages,
    });
    mockListConversationMessages.mockResolvedValueOnce([]);
    mockToUiMessages.mockReturnValueOnce([]);

    renderHook(() => useNosisChat("c5"));

    const [transportOptions] = transportCtorMock.mock.calls[0] as [
      {
        prepareSendMessagesRequest: (options: {
          id: string;
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            parts: Array<
              | { type: "text"; text?: string }
              | {
                  type: "file";
                  filename?: string;
                  mediaType?: string;
                  url: string;
                }
            >;
          }>;
          requestMetadata: unknown;
          body: Record<string, unknown> | undefined;
          credentials: RequestCredentials | undefined;
          headers: HeadersInit | undefined;
          api: string;
          trigger: "submit-message" | "regenerate-message";
          messageId: string | undefined;
        }) => { body: Record<string, unknown> };
      },
    ];

    const payload = transportOptions.prepareSendMessagesRequest({
      id: "c5",
      api: "/chat/c5",
      body: undefined,
      credentials: "include",
      headers: undefined,
      trigger: "regenerate-message",
      messageId: undefined,
      requestMetadata: {},
      messages: [
        {
          id: "m-user",
          role: "user",
          parts: [{ type: "file", url: "https://example.com/file.txt" }],
        },
      ],
    });

    expect(payload).toEqual({
      body: {
        messages: [
          {
            id: "m-user",
            role: "user",
            parts: [{ type: "file", url: "https://example.com/file.txt" }],
          },
        ],
        trigger: "regenerate-message",
        message_id: undefined,
        content: "",
      },
    });
  });
});
