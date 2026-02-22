"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCodeWorkspace } from "@nosis/components/code-workspace-provider";
import { GithubRepoList } from "@nosis/components/github-repo-list";
import {
  listGithubRepos,
  type GithubRepo,
} from "@nosis/features/github/api/worker-github-api";
import { Button } from "@nosis/ui/button";
import { authClient } from "@nosis/lib/auth-client";
import {
  reconnectGithubSignIn,
  REQUIRED_GITHUB_SCOPES,
} from "@nosis/lib/github-session";

interface AccessTokenPayload {
  scopes?: unknown;
  scope?: unknown;
  data?: {
    scopes?: unknown;
    scope?: unknown;
  };
}
const SCOPE_SPLIT_PATTERN = /[,\s]+/u;

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }

  if (typeof value === "string") {
    return value
      .split(SCOPE_SPLIT_PATTERN)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  return [];
}

function readGrantedScopes(payload: AccessTokenPayload): string[] {
  return [
    ...parseScopes(payload.scopes),
    ...parseScopes(payload.scope),
    ...parseScopes(payload.data?.scopes),
    ...parseScopes(payload.data?.scope),
  ];
}

export default function NewProjectPageClient() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const {
    createProjectFromRepoUrl,
    createWorkspaceForProject,
    isCreatingProject,
    isCreatingWorkspace,
    projectError,
    workspaceError,
  } = useCodeWorkspace();

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [isReposLoading, setIsReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [needsGithubReconnect, setNeedsGithubReconnect] = useState(false);
  const [selectedRepoUrl, setSelectedRepoUrl] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isSubmitting = isCreatingProject || isCreatingWorkspace;
  const combinedError = submitError ?? workspaceError ?? projectError;

  const loadRepos = useCallback(async () => {
    setReposError(null);
    setNeedsGithubReconnect(false);
    setIsReposLoading(true);
    try {
      const tokenResponse = (await authClient.getAccessToken({
        providerId: "github",
      })) as AccessTokenPayload;
      const grantedScopes = readGrantedScopes(tokenResponse);
      const missingScopes = REQUIRED_GITHUB_SCOPES.filter(
        (scope) => !grantedScopes.includes(scope)
      );
      if (missingScopes.length > 0) {
        setNeedsGithubReconnect(true);
        setReposError(
          `GitHub token is missing required scopes: ${missingScopes.join(", ")}`
        );
        setRepos([]);
        return;
      }

      const rows = await listGithubRepos(100, 0);
      setRepos(rows);
      if (rows.length > 0 && selectedRepoUrl.length === 0) {
        const defaultRepoUrl = `https://github.com/${rows[0]?.full_name}`;
        setSelectedRepoUrl(defaultRepoUrl);
      }
      if (rows.length === 0) {
        setReposError(
          "GitHub returned zero repositories for this account. If you expect private/org repos, verify org OAuth app approval or SSO authorization in GitHub."
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load repositories";
      const lowerMessage = message.toLowerCase();
      const shouldReconnect =
        lowerMessage.includes("token lacks required permissions") ||
        lowerMessage.includes("github account not connected");
      if (shouldReconnect) {
        setRepos([]);
        setNeedsGithubReconnect(true);
        setReposError(message);
      } else {
        setReposError(message);
      }
    } finally {
      setIsReposLoading(false);
    }
  }, [selectedRepoUrl]);

  useEffect(() => {
    loadRepos().catch(() => undefined);
  }, [loadRepos]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    try {
      const repoUrl = selectedRepoUrl.trim();
      if (!repoUrl) {
        setSubmitError("Select a GitHub repository.");
        return;
      }

      const project = await createProjectFromRepoUrl(repoUrl);
      await createWorkspaceForProject({
        kind: "cloud",
        projectId: project.id,
      });

      router.push("/code");
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to create project"
      );
    }
  };

  const reconnectGithub = async () => {
    await reconnectGithubSignIn(window.location.href);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
      <div className="border-[#f1f1f2] border-b px-6 py-4">
        <p className="font-normal text-[20px] text-black tracking-[-0.6px]">
          New Project
        </p>
        <p className="mt-1 font-normal text-[#808080] text-xs tracking-[-0.36px]">
          Connect a GitHub repository to create your first code workspace.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 py-6">
        <form className="w-full max-w-[720px] space-y-4" onSubmit={submit}>
          <div className="rounded border border-[#f1f1f2] px-3 py-2">
            <p className="text-[#808080] text-xs tracking-[-0.36px]">
              GitHub account
            </p>
            <p className="mt-1 text-[13px] text-black tracking-[-0.39px]">
              {session?.user?.email ?? session?.user?.name ?? "Connected"}
            </p>
          </div>

          <GithubRepoList
            isDisabled={isSubmitting}
            isLoading={isReposLoading}
            onSelectRepoUrl={(repoUrl) => {
              setSelectedRepoUrl(repoUrl);
            }}
            repos={repos}
            selectedRepoUrl={selectedRepoUrl}
          />

          {needsGithubReconnect ? (
            <div className="flex items-center justify-between gap-3 rounded border border-[#dfe7f3] bg-[#f8fbff] px-3 py-2">
              <p className="font-normal text-[#4a5565] text-sm tracking-[-0.42px]">
                Reconnect GitHub to refresh repository permissions for this
                account.
              </p>
              <Button
                onClick={() => {
                  reconnectGithub().catch(() => undefined);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Reconnect GitHub
              </Button>
            </div>
          ) : null}

          {reposError ? (
            <p className="font-normal text-red-600 text-sm tracking-[-0.42px]">
              {reposError}
            </p>
          ) : null}

          {!isReposLoading &&
          repos.length === 0 &&
          !needsGithubReconnect &&
          !reposError ? (
            <p className="font-normal text-[#808080] text-sm tracking-[-0.42px]">
              No repositories found for this GitHub account.
            </p>
          ) : null}

          {combinedError ? (
            <p className="font-normal text-red-600 text-sm tracking-[-0.42px]">
              {combinedError}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Link
              className="inline-flex h-9 items-center justify-center rounded border border-[#dadadd] px-3 font-normal text-sm hover:bg-[#f7f7f7]"
              href="/code"
            >
              Cancel
            </Link>
            <Button
              disabled={isSubmitting || selectedRepoUrl.trim().length === 0}
              size="sm"
              type="submit"
            >
              {isSubmitting ? "Creating..." : "Create project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
