"use client";

import { useMemo, useState } from "react";
import { GitBranch, Lock, Search } from "iconoir-react";
import type { GithubRepo } from "@nosis/features/github/api/worker-github-api";

interface GithubRepoListProps {
  repos: GithubRepo[];
  selectedRepoUrl: string;
  isDisabled?: boolean;
  isLoading?: boolean;
  onSelectRepoUrl: (repoUrl: string) => void;
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Updated recently";
  }

  return `Updated ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(parsed)}`;
}

function ownerInitial(login: string): string {
  const first = login.trim().charAt(0);
  if (first.length === 0) {
    return "?";
  }
  return first.toUpperCase();
}

export function GithubRepoList({
  repos,
  selectedRepoUrl,
  isDisabled = false,
  isLoading = false,
  onSelectRepoUrl,
}: GithubRepoListProps) {
  const [query, setQuery] = useState("");

  const filteredRepos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return repos;
    }

    return repos.filter((repo) => {
      const searchable = `${repo.full_name} ${repo.owner.login}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [query, repos]);

  return (
    <div className="space-y-2">
      <label
        className="block text-[#808080] text-xs tracking-[-0.36px]"
        htmlFor="github-repo-filter"
      >
        Repository
      </label>

      <div className="rounded-[7px] border border-[#dadadd] bg-white p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#808080]" />
          <input
            className="h-9 w-full rounded-[6px] border border-[#f1f1f2] bg-[#fcfcfd] pr-3 pl-9 text-[13px] tracking-[-0.39px] outline-none focus:border-[#dadadd]"
            disabled={isDisabled || isLoading}
            id="github-repo-filter"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Filter repositories"
            type="text"
            value={query}
          />
        </div>

        <div className="mt-2 max-h-[320px] space-y-1 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="rounded-[6px] px-2 py-8 text-center text-[#808080] text-sm tracking-[-0.39px]">
              Loading repositories...
            </p>
          ) : null}

          {!isLoading && filteredRepos.length === 0 ? (
            <p className="rounded-[6px] px-2 py-8 text-center text-[#808080] text-sm tracking-[-0.39px]">
              {repos.length === 0
                ? "No repositories available for this account."
                : "No repositories match your filter."}
            </p>
          ) : null}

          {isLoading
            ? null
            : filteredRepos.map((repo) => {
                const repoUrl = `https://github.com/${repo.full_name}`;
                const isSelected = selectedRepoUrl === repoUrl;
                return (
                  <button
                    className={`w-full rounded-[6px] border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "border-[#cfe7ff] bg-[#f6fbff]"
                        : "border-transparent hover:border-[#f1f1f2] hover:bg-[#f7f7f7]"
                    }`}
                    disabled={isDisabled}
                    key={repo.id}
                    onClick={() => {
                      onSelectRepoUrl(repoUrl);
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-[4px] bg-[#f1f1f2] text-[11px] text-black tracking-[-0.33px]">
                          {ownerInitial(repo.owner.login)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-black tracking-[-0.39px]">
                            {repo.full_name}
                          </p>
                          <p className="truncate text-[#808080] text-xs tracking-[-0.36px]">
                            {formatUpdatedAt(repo.updated_at)}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#f1f1f2] px-1.5 py-0.5 text-[#808080] text-[11px] tracking-[-0.33px]">
                          <GitBranch className="size-3" />
                          {repo.default_branch}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#f1f1f2] px-1.5 py-0.5 text-[#808080] text-[11px] tracking-[-0.33px]">
                          {repo.private ? (
                            <Lock className="size-3" />
                          ) : (
                            <span className="size-3 text-center text-[10px] leading-none">
                              •
                            </span>
                          )}
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
        </div>
      </div>
    </div>
  );
}
