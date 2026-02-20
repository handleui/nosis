"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createConversation,
  listConversations,
  type Conversation,
} from "@nosis/lib/worker-api";

interface UseConversationsResult {
  conversations: Conversation[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createNewConversation: (title?: string) => Promise<Conversation>;
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await listConversations(100, 0);
      setConversations(rows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load conversations"
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    listConversations(100, 0)
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setConversations(rows);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load conversations"
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const createNewConversation = useCallback(async (title?: string) => {
    setIsCreating(true);
    setError(null);
    try {
      const conversation = await createConversation(title);
      setConversations((existing) => [conversation, ...existing]);
      return conversation;
    } finally {
      setIsCreating(false);
    }
  }, []);

  return {
    conversations,
    isLoading,
    isCreating,
    error,
    refresh,
    createNewConversation,
  };
}
