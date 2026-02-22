"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGithubBranches,
  fetchPullRequestDetail,
  fetchPullRequests,
  parseGithubRepoUrl,
} from "@nosis/features/github/lib/git-ops";
import {
  createGitWorkspaceRuntime,
  getGitWorkspaceErrorMessage,
} from "@nosis/features/github/lib/git-workspace-runtime";
import type {
  Project,
  Workspace,
} from "@nosis/features/code/api/worker-code-api";
import type {
  GithubBranch,
  GithubPullRequest,
  GithubPullRequestDetailResponse,
} from "@nosis/features/github/api/worker-github-api";

interface UseGithubControlsParams {
  project: Project | null;
  workspace: Workspace | null;
}

interface UseGithubControlsResult {
  pulls: GithubPullRequest[];
  branches: GithubBranch[];
  selectedPullNumber: number | null;
  selectedPullDetail: GithubPullRequestDetailResponse | null;
  isPullsLoading: boolean;
  isBranchesLoading: boolean;
  isPullDetailLoading: boolean;
  isCreatingBranch: boolean;
  isCreatingPr: boolean;
  error: string | null;
  actionError: string | null;
  selectPullNumber: (value: number | null) => void;
  clearActionError: () => void;
  refreshPulls: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  createBranch: (input: { name: string; from: string }) => Promise<void>;
  createPullRequest: (input: {
    title: string;
    head: string;
    base: string;
    body?: string;
  }) => Promise<number>;
}

function makeOptimisticPull(input: {
  number: number;
  title: string;
  head: string;
  base: string;
}): GithubPullRequest {
  const now = new Date().toISOString();
  return {
    number: input.number,
    title: input.title,
    state: "open",
    head: {
      ref: input.head,
      sha: "",
    },
    base: {
      ref: input.base,
    },
    user: {
      login: "you",
      avatar_url: "",
    },
    created_at: now,
    updated_at: now,
  };
}

export function useGithubControls({
  project,
  workspace,
}: UseGithubControlsParams): UseGithubControlsResult {
  const repo = useMemo(
    () => (project ? parseGithubRepoUrl(project.repo_url) : null),
    [project]
  );
  const runtime = useMemo(
    () => createGitWorkspaceRuntime(workspace),
    [workspace]
  );

  const [pulls, setPulls] = useState<GithubPullRequest[]>([]);
  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [selectedPullNumber, setSelectedPullNumber] = useState<number | null>(
    null
  );
  const [selectedPullDetail, setSelectedPullDetail] =
    useState<GithubPullRequestDetailResponse | null>(null);
  const [isPullsLoading, setIsPullsLoading] = useState(false);
  const [isBranchesLoading, setIsBranchesLoading] = useState(false);
  const [isPullDetailLoading, setIsPullDetailLoading] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasGitContext = Boolean(project && workspace && repo);

  const refreshPulls = useCallback(async () => {
    if (!repo) {
      setPulls([]);
      setSelectedPullNumber(null);
      setSelectedPullDetail(null);
      return;
    }

    setIsPullsLoading(true);
    setError(null);
    try {
      const rows = await fetchPullRequests(repo, { limit: 30, offset: 0 });
      setPulls(rows);
      if (rows.length === 0) {
        setSelectedPullNumber(null);
        setSelectedPullDetail(null);
      } else {
        setSelectedPullNumber((current) => {
          if (
            current !== null &&
            current > 0 &&
            rows.some((pull) => pull.number === current)
          ) {
            return current;
          }
          return rows[0]?.number ?? null;
        });
      }
    } catch (err) {
      setError(getGitWorkspaceErrorMessage(err));
    } finally {
      setIsPullsLoading(false);
    }
  }, [repo]);

  const refreshBranches = useCallback(async () => {
    if (!repo) {
      setBranches([]);
      return;
    }

    setIsBranchesLoading(true);
    setError(null);
    try {
      const rows = await fetchGithubBranches(repo, { limit: 50, offset: 0 });
      setBranches(rows);
    } catch (err) {
      setError(getGitWorkspaceErrorMessage(err));
    } finally {
      setIsBranchesLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    refreshPulls().catch(() => undefined);
    refreshBranches().catch(() => undefined);
  }, [refreshPulls, refreshBranches]);

  useEffect(() => {
    if (!repo || selectedPullNumber === null || selectedPullNumber <= 0) {
      setSelectedPullDetail(null);
      return;
    }

    let cancelled = false;
    setIsPullDetailLoading(true);
    setError(null);

    const detailRequest = fetchPullRequestDetail(repo, selectedPullNumber);
    if (!detailRequest || typeof detailRequest.then !== "function") {
      setError("Failed to load pull request detail");
      setSelectedPullDetail(null);
      setIsPullDetailLoading(false);
      return;
    }

    detailRequest
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setSelectedPullDetail(detail);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(getGitWorkspaceErrorMessage(err));
        setSelectedPullDetail(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsPullDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo, selectedPullNumber]);

  const createBranch = useCallback(
    async (input: { name: string; from: string }) => {
      if (!(hasGitContext && project && workspace)) {
        setActionError("Select a project workspace to run Git actions.");
        return;
      }

      const name = input.name.trim();
      if (!name) {
        setActionError("Branch name is required");
        return;
      }

      const from = input.from.trim();
      if (!from) {
        setActionError("Base branch is required");
        return;
      }

      const optimisticBranch: GithubBranch = {
        name,
        commit: { sha: "" },
        protected: false,
      };
      const alreadyListed = branches.some((branch) => branch.name === name);

      setActionError(null);
      setIsCreatingBranch(true);
      if (!alreadyListed) {
        setBranches((current) => [optimisticBranch, ...current]);
      }

      try {
        await runtime.ensureRepo(project);
        const branch = await runtime.ensureWorkspaceBranch(workspace, {
          name,
          from,
        });
        setBranches((current) => [
          branch,
          ...current.filter((item) => item.name !== branch.name),
        ]);
        refreshBranches().catch(() => undefined);
      } catch (err) {
        if (!alreadyListed) {
          setBranches((current) =>
            current.filter((branch) => branch.name !== name)
          );
        }
        setActionError(getGitWorkspaceErrorMessage(err));
        throw err;
      } finally {
        setIsCreatingBranch(false);
      }
    },
    [branches, hasGitContext, project, refreshBranches, runtime, workspace]
  );

  const createPullRequest = useCallback(
    async (input: {
      title: string;
      head: string;
      base: string;
      body?: string;
    }) => {
      if (!(hasGitContext && project && workspace)) {
        setActionError("Select a project workspace to run Git actions.");
        throw new Error("Project workspace is required");
      }

      const title = input.title.trim();
      if (!title) {
        setActionError("Pull request title is required");
        throw new Error("Pull request title is required");
      }

      const head = input.head.trim();
      if (!head) {
        setActionError("Create or enter a branch before opening a PR");
        throw new Error("Head branch is required");
      }

      const base = input.base.trim();
      if (!base) {
        setActionError("Base branch is required");
        throw new Error("Base branch is required");
      }

      const optimisticNumber = -Date.now();
      const optimisticPr = makeOptimisticPull({
        number: optimisticNumber,
        title,
        head,
        base,
      });

      setActionError(null);
      setIsCreatingPr(true);
      setPulls((current) => [optimisticPr, ...current]);

      try {
        await runtime.ensureRepo(project);
        const pr = await runtime.openPullRequest({
          title,
          head,
          base,
          body: input.body,
        });
        setPulls((current) => [
          pr,
          ...current.filter(
            (item) =>
              item.number !== optimisticNumber && item.number !== pr.number
          ),
        ]);
        setSelectedPullNumber(pr.number);
        refreshPulls().catch(() => undefined);
        return pr.number;
      } catch (err) {
        setPulls((current) =>
          current.filter((item) => item.number !== optimisticNumber)
        );
        setActionError(getGitWorkspaceErrorMessage(err));
        throw err;
      } finally {
        setIsCreatingPr(false);
      }
    },
    [hasGitContext, project, refreshPulls, runtime, workspace]
  );

  const clearActionError = useCallback(() => {
    setActionError(null);
  }, []);

  return {
    pulls,
    branches,
    selectedPullNumber,
    selectedPullDetail,
    isPullsLoading,
    isBranchesLoading,
    isPullDetailLoading,
    isCreatingBranch,
    isCreatingPr,
    error,
    actionError,
    selectPullNumber: setSelectedPullNumber,
    clearActionError,
    refreshPulls,
    refreshBranches,
    createBranch,
    createPullRequest,
  };
}
