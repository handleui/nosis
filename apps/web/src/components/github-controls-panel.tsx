"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { GitPullRequest } from "iconoir-react";
import type {
  Project,
  Workspace,
} from "@nosis/features/code/api/worker-code-api";
import { buildWorkspaceBranchName } from "@nosis/features/github/lib/git-ops";
import { useGithubControls } from "@nosis/features/github/hooks/use-github-controls";
import { Button } from "@nosis/ui/button";

interface GithubControlsPanelProps {
  project: Project | null;
  workspace: Workspace | null;
}

function renderPullRequestDetailContent(
  isPullDetailLoading: boolean,
  selectedPullDetail: ReturnType<typeof useGithubControls>["selectedPullDetail"]
) {
  if (isPullDetailLoading) {
    return <p className="text-[#808080] text-[12px]">Loading PR detail...</p>;
  }
  if (!selectedPullDetail) {
    return (
      <p className="text-[#808080] text-[12px]">Select a PR to inspect.</p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <p className="font-medium text-black">{selectedPullDetail.pr.title}</p>
      <p className="text-[#808080]">
        {selectedPullDetail.pr.head.ref} → {selectedPullDetail.pr.base.ref}
      </p>
      <p className="text-[#808080]">
        +{selectedPullDetail.pr.additions} / -{selectedPullDetail.pr.deletions}{" "}
        · {selectedPullDetail.pr.changed_files} files
      </p>
      <p className="text-[#808080]">
        Checks: {selectedPullDetail.check_runs.length}
      </p>
    </div>
  );
}

export default function GithubControlsPanel({
  project,
  workspace,
}: GithubControlsPanelProps) {
  const {
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
    selectPullNumber,
    clearActionError,
    refreshPulls,
    refreshBranches,
    createBranch,
    createPullRequest,
  } = useGithubControls({ project, workspace });

  const suggestedBranch = useMemo(() => {
    if (!workspace) {
      return null;
    }
    return buildWorkspaceBranchName({
      title: workspace.name,
      workspaceId: workspace.id,
      prefix: "nosis",
    });
  }, [workspace]);

  const defaultBaseBranch =
    workspace?.base_branch ?? project?.default_branch ?? "main";
  const defaultWorkingBranch =
    workspace?.working_branch ?? suggestedBranch ?? "";
  const defaultPrTitle = workspace ? `WIP: ${workspace.name}` : "";

  const [branchNameInput, setBranchNameInput] = useState("");
  const [hasEditedBranchName, setHasEditedBranchName] = useState(false);
  const [prTitleInput, setPrTitleInput] = useState("");
  const [hasEditedPrTitle, setHasEditedPrTitle] = useState(false);
  const [prBodyInput, setPrBodyInput] = useState("");

  const resolvedBranchNameInput = hasEditedBranchName
    ? branchNameInput
    : defaultWorkingBranch;
  const resolvedPrTitleInput = hasEditedPrTitle ? prTitleInput : defaultPrTitle;

  const handleCreateBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createBranch({
      name: resolvedBranchNameInput,
      from: defaultBaseBranch,
    }).catch(() => undefined);
  };

  const handleCreatePullRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    createPullRequest({
      title: resolvedPrTitleInput,
      head: resolvedBranchNameInput,
      base: defaultBaseBranch,
      body: prBodyInput.trim() || undefined,
    }).catch(() => undefined);
  };

  const isBranchSubmitDisabled =
    isCreatingBranch || resolvedBranchNameInput.trim().length === 0;
  const isPrSubmitDisabled =
    isCreatingPr ||
    resolvedPrTitleInput.trim().length === 0 ||
    resolvedBranchNameInput.trim().length === 0;

  const handleRefreshBranches = () => {
    refreshBranches().catch(() => undefined);
  };

  const handleRefreshPulls = () => {
    refreshPulls().catch(() => undefined);
  };

  const handleBranchNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    clearActionError();
    setHasEditedBranchName(true);
    setBranchNameInput(event.target.value);
  };

  const handlePrTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    clearActionError();
    setHasEditedPrTitle(true);
    setPrTitleInput(event.target.value);
  };

  const handlePrBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    clearActionError();
    setPrBodyInput(event.target.value);
  };

  const pullRequestDetailContent = renderPullRequestDetailContent(
    isPullDetailLoading,
    selectedPullDetail
  );

  if (!project) {
    return (
      <div className="px-4 pb-6">
        <p className="font-normal text-[#808080] text-xs tracking-[-0.36px]">
          Select a project workspace to load GitHub controls.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top,_#f3fff8_0%,_#ffffff_42%)] px-4 pb-6">
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-[#e7efe8] border-b bg-white/88 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium text-[#111] text-[13px] tracking-[-0.39px]">
              {project.owner}/{project.repo}
            </p>
            <p className="font-normal text-[#808080] text-[11px] tracking-[-0.33px]">
              GitHub Controls
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#c4f4d2] bg-[#ebffef] px-2 py-1">
            <GitPullRequest className="size-3 text-[#2ca24d]" />
            <p className="font-medium text-[#2ca24d] text-[11px] leading-[1]">
              #{selectedPullNumber ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-[#d8efe1] bg-white/88 p-3 shadow-[0_14px_34px_rgba(37,163,93,0.08)]">
        <p className="font-normal text-[#6b8572] text-[11px] tracking-[-0.33px]">
          Suggested workspace branch
        </p>
        <p className="mt-1 font-mono text-[#111] text-[12px] tracking-[-0.36px]">
          {defaultWorkingBranch || "-"}
        </p>
        <p className="mt-1 font-normal text-[#808080] text-[11px] tracking-[-0.33px]">
          Base branch: {defaultBaseBranch}
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-[#e7e7ea] bg-white p-3 shadow-[0_14px_34px_rgba(10,10,10,0.06)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-medium text-[#232323] text-[12px] tracking-[-0.36px]">
            GitHub Sync
          </p>
          <div className="flex items-center gap-2">
            <Button
              className="h-7 rounded-[8px] border-[#d7ddd8] px-2 text-[11px]"
              onClick={handleRefreshBranches}
              size="sm"
              type="button"
              variant="outline"
            >
              {isBranchesLoading ? "Loading..." : "Branches"}
            </Button>
            <Button
              className="h-7 rounded-[8px] border-[#d7ddd8] px-2 text-[11px]"
              onClick={handleRefreshPulls}
              size="sm"
              type="button"
              variant="outline"
            >
              {isPullsLoading ? "Loading..." : "PRs"}
            </Button>
          </div>
        </div>

        <form className="flex flex-col gap-2" onSubmit={handleCreateBranch}>
          <input
            className="h-9 rounded-lg border border-[#dce4de] bg-white px-3 font-mono text-[#111] text-[12px] outline-none focus:border-[#77d79e]"
            onChange={handleBranchNameChange}
            placeholder="feature/my-branch"
            value={resolvedBranchNameInput}
          />
          <Button
            className="h-9 rounded-lg bg-[#111] text-[12px] text-white hover:bg-[#222]"
            disabled={isBranchSubmitDisabled}
            size="sm"
            type="submit"
          >
            {isCreatingBranch ? "Creating branch..." : "Create branch"}
          </Button>
        </form>

        <form
          className="mt-3 flex flex-col gap-2 border-[#edf0ee] border-t pt-3"
          onSubmit={handleCreatePullRequest}
        >
          <input
            className="h-9 rounded-lg border border-[#dce4de] bg-white px-3 text-[#111] text-[12px] outline-none focus:border-[#77d79e]"
            onChange={handlePrTitleChange}
            placeholder="Pull request title"
            value={resolvedPrTitleInput}
          />
          <textarea
            className="min-h-20 rounded-lg border border-[#dce4de] bg-white px-3 py-2 text-[#111] text-[12px] outline-none focus:border-[#77d79e]"
            onChange={handlePrBodyChange}
            placeholder="PR description (optional)"
            value={prBodyInput}
          />
          <Button
            className="h-9 rounded-lg bg-[#dfffdf] text-[#2ca24d] text-[12px] hover:bg-[#cef8d3]"
            disabled={isPrSubmitDisabled}
            size="sm"
            type="submit"
          >
            {isCreatingPr ? "Opening PR..." : `Open PR to ${defaultBaseBranch}`}
          </Button>
        </form>
      </div>

      <div className="mb-4 rounded-xl border border-[#e7e7ea] bg-white p-3 shadow-[0_10px_24px_rgba(10,10,10,0.05)]">
        <p className="mb-2 font-medium text-[#232323] text-[12px] tracking-[-0.36px]">
          Pull Requests
        </p>
        {pulls.length === 0 ? (
          <p className="font-normal text-[#808080] text-[12px]">
            No PRs found.
          </p>
        ) : (
          <div className="max-h-[190px] space-y-1 overflow-auto">
            {pulls.map((pull) => (
              <button
                className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left transition-colors ${
                  selectedPullNumber === pull.number
                    ? "border-[#c4f4d2] bg-[#ebffef]"
                    : "border-transparent bg-[#f7f8f7] hover:bg-[#f0f3f1]"
                }`}
                key={pull.number}
                onClick={() => selectPullNumber(pull.number)}
                type="button"
              >
                <span className="truncate text-[#111] text-[12px]">
                  #{pull.number} {pull.title}
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-white px-2 py-0.5 text-[#6a6a6a] text-[10px] uppercase">
                  {pull.state}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-[#e7e7ea] bg-white p-3 shadow-[0_10px_24px_rgba(10,10,10,0.05)]">
        <p className="mb-2 font-medium text-[#232323] text-[12px] tracking-[-0.36px]">
          Pull Request Detail
        </p>
        {pullRequestDetailContent}
      </div>

      <div className="rounded-xl border border-[#e7e7ea] bg-white p-3 shadow-[0_10px_24px_rgba(10,10,10,0.05)]">
        <p className="mb-2 font-medium text-[#232323] text-[12px] tracking-[-0.36px]">
          Branches ({branches.length})
        </p>
        <div className="max-h-[140px] space-y-1 overflow-auto">
          {branches.map((branch) => (
            <p
              className="rounded bg-[#f7f8f7] px-2 py-1 font-mono text-[#3e3e3e] text-[11px]"
              key={branch.name}
            >
              {branch.name}
            </p>
          ))}
          {branches.length === 0 ? (
            <p className="text-[#808080] text-[12px]">No branches loaded.</p>
          ) : null}
        </div>
      </div>

      {error || actionError ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-normal text-[12px] text-red-700 tracking-[-0.36px]">
          {actionError ?? error}
        </p>
      ) : null}
    </div>
  );
}
