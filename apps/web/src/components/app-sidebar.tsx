"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Database,
  FolderPlus,
  GitPullRequest,
  Internet,
  MessageText,
  NavArrowDown,
  OpenBook,
  Plus,
  Repeat,
  SidebarCollapse,
  SidebarExpand,
} from "iconoir-react";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "@nosis/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage, Facehash } from "facehash";
import type { Conversation } from "@nosis/features/chat/api/worker-chat-api";
import type {
  Project,
  Workspace,
} from "@nosis/features/code/api/worker-code-api";
import { authClient } from "@nosis/lib/auth-client";

type SidebarNavItem = "habits" | "integrations" | "chat" | "code";

interface AppSidebarProps {
  conversations: Conversation[];
  projects: Project[];
  allWorkspaces: Workspace[];
  selectedProjectId: string | null;
  activeConversationId: string | null;
  isSidebarOpen: boolean;
  isLoading: boolean;
  isProjectsLoading: boolean;
  error: string | null;
  onCreateConversation: (mode: "chat" | "code") => void;
  onToggleSidebar: () => void;
  onSelectConversation: (input: {
    conversationId: string;
    projectId: string | null;
    workspaceId: string | null;
    mode: "chat" | "code";
  }) => void;
}

interface ConversationStats {
  added: number;
  removed: number;
}

interface ConversationGroup {
  key: string;
  label: string;
  projectId: string | null;
  rows: Conversation[];
}

const FACEHASH_COLORS = [
  "#5a4de6",
  "#2b7fff",
  "#0f9d8a",
  "#f3a33c",
  "#ef5a5a",
] as const;

function deriveRouteMode(pathname: string): "chat" | "code" {
  if (pathname.startsWith("/code")) {
    return "code";
  }
  if (pathname === "/" || pathname.startsWith("/chat")) {
    return "chat";
  }
  return "code";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getConversationStats(
  conversation: Conversation
): ConversationStats | null {
  const row = conversation as Conversation & {
    additions?: unknown;
    deletions?: unknown;
    lines_added?: unknown;
    lines_removed?: unknown;
  };

  const added = row.lines_added ?? row.additions;
  const removed = row.lines_removed ?? row.deletions;
  if (!(isNumber(added) && isNumber(removed))) {
    return null;
  }

  return {
    added: Math.max(0, Math.floor(added)),
    removed: Math.max(0, Math.floor(removed)),
  };
}

function FacehashSquare({ seed }: { seed: string }) {
  return (
    <div className="size-4 overflow-hidden rounded-[4px]">
      <Facehash
        colors={[...FACEHASH_COLORS]}
        intensity3d="subtle"
        interactive={false}
        name={seed}
        showInitial={false}
        size={16}
        variant="solid"
      />
    </div>
  );
}

function UserAvatarSquare({
  imageUrl,
  seed,
}: {
  imageUrl: string | null;
  seed: string;
}) {
  return (
    <Avatar
      className="size-5 overflow-hidden rounded-[4px]"
      style={{ width: 20, height: 20 }}
    >
      <AvatarImage alt="User avatar" src={imageUrl} />
      <AvatarFallback
        facehash
        facehashProps={{
          colors: [...FACEHASH_COLORS],
          intensity3d: "subtle",
          interactive: false,
          showInitial: false,
          variant: "solid",
        }}
        name={seed}
      />
    </Avatar>
  );
}

function WorkspaceHeader({
  onToggleSidebar,
  officeSeed,
  isCollapsed,
}: {
  onToggleSidebar: () => void;
  officeSeed: string;
  isCollapsed: boolean;
}) {
  return (
    <div
      className={`flex h-10 items-center ${
        isCollapsed ? "justify-center px-2" : "justify-between px-4"
      }`}
    >
      <div className={`flex items-center ${isCollapsed ? "" : "gap-2.5"}`}>
        <FacehashSquare seed={officeSeed} />
        {isCollapsed ? null : (
          <>
            <p className="text-[13px] text-black tracking-[-0.39px]">
              Workspace
            </p>

            <NavArrowDown className="size-3 text-[#808080]" />
          </>
        )}
      </div>

      {isCollapsed ? null : (
        <button
          aria-label="Toggle sidebar"
          className="flex size-4 items-center justify-center"
          onClick={onToggleSidebar}
          type="button"
        >
          <SidebarCollapse className="size-4 text-[#808080]" />
        </button>
      )}
    </div>
  );
}

function SidebarIcon({
  item,
  className,
}: {
  item: SidebarNavItem;
  className: string;
}) {
  if (item === "chat") {
    return <MessageText className={className} />;
  }
  if (item === "code") {
    return <GitPullRequest className={className} />;
  }
  if (item === "integrations") {
    return <Internet className={className} />;
  }
  return <Repeat className={className} />;
}

function SidebarButton({
  item,
  label,
  selected,
  onClick,
  collapsed = false,
}: {
  item: SidebarNavItem;
  label: string;
  selected: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  const toneClass = selected ? "text-[#0080ff]" : "text-black";
  const iconSizeClass = "size-4";
  const buttonClass = collapsed
    ? `flex size-8 items-center justify-center rounded-[12px] ${
        selected ? "bg-[#f6fbff]" : "hover:bg-[#f7f7f7]"
      }`
    : `flex h-8 w-full items-center gap-3 rounded-[8px] px-2 text-left ${
        selected ? "bg-[#f6fbff]" : "hover:bg-[#f7f7f7]"
      }`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-0.5">
        <TooltipRoot>
          <TooltipTrigger
            aria-label={label}
            className={buttonClass}
            onClick={onClick}
          >
            <SidebarIcon
              className={`${iconSizeClass} shrink-0 ${toneClass}`}
              item={item}
            />
          </TooltipTrigger>
          <TooltipContent
            className="rounded-[8px] px-2 py-1"
            side="right"
            sideOffset={12}
          >
            {label}
          </TooltipContent>
        </TooltipRoot>
      </div>
    );
  }

  return (
    <div className="w-full px-2 py-0.5">
      <button
        aria-label={label}
        className={buttonClass}
        onClick={onClick}
        type="button"
      >
        <SidebarIcon
          className={`${iconSizeClass} shrink-0 ${toneClass}`}
          item={item}
        />
        <p className={`text-[13px] tracking-[-0.39px] ${toneClass}`}>{label}</p>
      </button>
    </div>
  );
}

function SectionHeader({
  label,
  muted = false,
  showIcon = true,
  onCreate,
  onSelect,
}: {
  label: string;
  muted?: boolean;
  showIcon?: boolean;
  onCreate?: () => void;
  onSelect?: () => void;
}) {
  const textClass = `text-xs tracking-[-0.36px] ${
    muted ? "text-[#808080]" : "text-black"
  }`;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2.5">
        {showIcon ? <Database className="size-3.5 text-[#808080]" /> : null}
        {onSelect ? (
          <button
            className={`${textClass} bg-transparent text-left hover:text-black`}
            onClick={onSelect}
            type="button"
          >
            {label}
          </button>
        ) : (
          <p className={textClass}>{label}</p>
        )}
      </div>

      {onCreate ? (
        <button
          aria-label="Create thread"
          className="flex size-3 items-center justify-center"
          onClick={onCreate}
          type="button"
        >
          <Plus className="size-3 text-[#808080]" />
        </button>
      ) : null}
    </div>
  );
}

function ConversationRow({
  conversation,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const stats = getConversationStats(conversation);

  return (
    <div className="px-2 py-1">
      <button
        className={`flex h-9 w-full items-center justify-between rounded-[4px] px-2 text-left ${
          isActive ? "bg-[#f6fbff]" : "bg-white"
        }`}
        onClick={onClick}
        type="button"
      >
        <p
          className={`truncate text-[14px] tracking-[-0.42px] ${
            isActive ? "text-[#0080ff]" : "text-black"
          }`}
        >
          {conversation.title}
        </p>

        {stats ? (
          <div className="ml-3 flex items-center gap-2 text-[13px] leading-[1.2] tracking-[-0.39px]">
            <p className="text-[#00ec7e]">+{stats.added}</p>
            <p className="text-[#f53b3a]">-{stats.removed}</p>
          </div>
        ) : null}
      </button>
    </div>
  );
}

export default function AppSidebar({
  conversations,
  projects,
  allWorkspaces,
  selectedProjectId,
  activeConversationId,
  isSidebarOpen,
  isLoading,
  isProjectsLoading,
  error,
  onCreateConversation,
  onToggleSidebar,
  onSelectConversation,
}: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const activeMode = useMemo(() => deriveRouteMode(pathname), [pathname]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const officeSeed = useMemo(
    () => selectedProject?.owner ?? projects[0]?.owner ?? "nosis",
    [projects, selectedProject?.owner]
  );

  const userSeed = useMemo(
    () => session?.user?.email ?? session?.user?.name ?? "nosis-user",
    [session?.user?.email, session?.user?.name]
  );
  const userImage = useMemo(() => {
    const user = session?.user;
    if (!user) {
      return null;
    }

    if (typeof user.image === "string" && user.image.trim().length > 0) {
      return user.image;
    }

    const withAvatarUrl = user as Record<string, unknown>;
    const avatarUrl = withAvatarUrl.avatar_url;
    if (typeof avatarUrl === "string" && avatarUrl.trim().length > 0) {
      return avatarUrl;
    }

    return null;
  }, [session?.user]);

  const workspaceById = useMemo(
    () => new Map(allWorkspaces.map((workspace) => [workspace.id, workspace])),
    [allWorkspaces]
  );

  // Code threads are attached to a workspace; chat threads are not.
  const codeThreads = useMemo(
    () => conversations.filter((conversation) => conversation.workspace_id),
    [conversations]
  );

  const chatThreads = useMemo(
    () => conversations.filter((conversation) => !conversation.workspace_id),
    [conversations]
  );

  const groups = useMemo<ConversationGroup[]>(() => {
    const groupedByProjectId = new Map<string, Conversation[]>();
    const unassigned: Conversation[] = [];

    for (const project of projects) {
      groupedByProjectId.set(project.id, []);
    }

    for (const conversation of codeThreads) {
      if (!conversation.workspace_id) {
        unassigned.push(conversation);
        continue;
      }

      const workspace = workspaceById.get(conversation.workspace_id);
      if (!workspace) {
        unassigned.push(conversation);
        continue;
      }

      const rows = groupedByProjectId.get(workspace.project_id);
      if (!rows) {
        unassigned.push(conversation);
        continue;
      }
      rows.push(conversation);
    }

    const projectGroups: ConversationGroup[] = projects
      .map((project) => ({
        key: project.id,
        label: project.repo,
        projectId: project.id,
        rows: groupedByProjectId.get(project.id) ?? [],
      }))
      .filter((group) => group.rows.length > 0 || isProjectsLoading);

    if (unassigned.length > 0) {
      projectGroups.push({
        key: "general",
        label: "General",
        projectId: null,
        rows: unassigned,
      });
    }

    return projectGroups;
  }, [codeThreads, isProjectsLoading, projects, workspaceById]);

  const handleOpenChat = useCallback(() => {
    if (pathname !== "/" && !pathname.startsWith("/chat")) {
      router.push("/");
    }
  }, [pathname, router]);

  const handleOpenCode = useCallback(() => {
    if (!pathname.startsWith("/code")) {
      router.push("/code");
    }
  }, [pathname, router]);

  const handleOpenNewProject = useCallback(() => {
    router.push("/code/new");
  }, [router]);
  const handleOpenDocs = useCallback(() => {
    window.open("https://nosis.sh/docs", "_blank", "noopener,noreferrer");
  }, []);

  const isCollapsed = !isSidebarOpen;

  if (isCollapsed) {
    return (
      <TooltipProvider>
        <div className="flex size-full flex-col justify-between bg-white">
          <div className="border-[#f0f0f0] border-b pt-1 pb-2">
            <WorkspaceHeader
              isCollapsed
              officeSeed={officeSeed}
              onToggleSidebar={onToggleSidebar}
            />

            <div className="mt-1 flex flex-col items-center -space-y-1">
              <SidebarButton
                collapsed
                item="habits"
                label="Habits"
                selected={false}
              />
              <SidebarButton
                collapsed
                item="integrations"
                label="Integrations"
                selected={false}
              />
              <SidebarButton
                collapsed
                item="chat"
                label="Chat"
                onClick={handleOpenChat}
                selected={activeMode === "chat"}
              />
              <SidebarButton
                collapsed
                item="code"
                label="Code"
                onClick={handleOpenCode}
                selected={activeMode === "code"}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 border-[#f1f1f2] border-t py-3">
            <TooltipRoot>
              <TooltipTrigger
                aria-label="Add Project"
                className="flex size-8 items-center justify-center rounded-[12px] hover:bg-[#f7f7f7]"
                onClick={handleOpenNewProject}
              >
                <FolderPlus className="size-4 text-black" />
              </TooltipTrigger>
              <TooltipContent
                className="rounded-[8px] px-2 py-1"
                side="right"
                sideOffset={12}
              >
                Add Project
              </TooltipContent>
            </TooltipRoot>

            <TooltipRoot>
              <TooltipTrigger
                aria-label="Open docs"
                className="flex size-8 items-center justify-center rounded-[12px] hover:bg-[#f7f7f7]"
                onClick={handleOpenDocs}
              >
                <OpenBook className="size-4 text-[#808080]" />
              </TooltipTrigger>
              <TooltipContent
                className="rounded-[8px] px-2 py-1"
                side="right"
                sideOffset={12}
              >
                Docs
              </TooltipContent>
            </TooltipRoot>

            <TooltipRoot>
              <TooltipTrigger
                aria-label="Expand sidebar"
                className="group relative flex size-8 items-center justify-center rounded-[12px] hover:bg-[#f7f7f7]"
                onClick={onToggleSidebar}
              >
                <span className="transition-opacity duration-150 group-hover:opacity-0">
                  <UserAvatarSquare imageUrl={userImage} seed={userSeed} />
                </span>
                <SidebarExpand className="pointer-events-none absolute size-4 text-[#808080] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
              </TooltipTrigger>
              <TooltipContent
                className="rounded-[8px] px-2 py-1"
                side="right"
                sideOffset={12}
              >
                Expand Sidebar
              </TooltipContent>
            </TooltipRoot>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex size-full flex-col justify-between bg-white">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="border-[#f0f0f0] border-b pt-1 pb-2">
          <WorkspaceHeader
            isCollapsed={false}
            officeSeed={officeSeed}
            onToggleSidebar={onToggleSidebar}
          />

          <div className="-space-y-1">
            <SidebarButton item="habits" label="Habits" selected={false} />
            <SidebarButton
              item="integrations"
              label="Integrations"
              selected={false}
            />
            <SidebarButton
              item="chat"
              label="Chat"
              onClick={handleOpenChat}
              selected={activeMode === "chat"}
            />
            <SidebarButton
              item="code"
              label="Code"
              onClick={handleOpenCode}
              selected={activeMode === "code"}
            />
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {activeMode === "code" ? (
            <>
              {groups.map((group) => (
                <section key={group.key}>
                  <SectionHeader
                    label={group.label}
                    muted={selectedProjectId !== group.projectId}
                    onCreate={() => onCreateConversation("code")}
                    onSelect={
                      group.projectId
                        ? () => router.push(`/code/${group.projectId}`)
                        : undefined
                    }
                  />

                  {group.rows.map((conversation) => (
                    <ConversationRow
                      conversation={conversation}
                      isActive={conversation.id === activeConversationId}
                      key={conversation.id}
                      onClick={() => {
                        onSelectConversation({
                          conversationId: conversation.id,
                          projectId: group.projectId,
                          workspaceId: conversation.workspace_id ?? null,
                          mode: "code",
                        });
                      }}
                    />
                  ))}
                </section>
              ))}

              {isProjectsLoading ? (
                <p className="px-4 py-3 text-[#808080] text-sm tracking-[-0.42px]">
                  Loading projects...
                </p>
              ) : null}

              {isLoading ? (
                <p className="px-4 py-3 text-[#808080] text-sm tracking-[-0.42px]">
                  Loading threads...
                </p>
              ) : null}

              {!(isProjectsLoading || isLoading) && groups.length === 0 ? (
                <p className="px-4 py-3 text-[#808080] text-sm tracking-[-0.42px]">
                  No code threads yet
                </p>
              ) : null}
            </>
          ) : null}

          {activeMode === "chat" ? (
            <>
              <SectionHeader
                label="Chats"
                onCreate={() => onCreateConversation("chat")}
                showIcon={false}
              />

              {chatThreads.map((conversation) => (
                <ConversationRow
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  key={conversation.id}
                  onClick={() => {
                    onSelectConversation({
                      conversationId: conversation.id,
                      projectId: null,
                      workspaceId: conversation.workspace_id ?? null,
                      mode: "chat",
                    });
                  }}
                />
              ))}

              {!isLoading && chatThreads.length === 0 ? (
                <p className="px-4 py-3 text-[#808080] text-sm tracking-[-0.42px]">
                  No chat threads yet
                </p>
              ) : null}

              {isLoading ? (
                <p className="px-4 py-3 text-[#808080] text-sm tracking-[-0.42px]">
                  Loading threads...
                </p>
              ) : null}
            </>
          ) : null}

          {error ? (
            <p className="px-4 py-3 text-red-600 text-sm tracking-[-0.42px]">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex h-10 items-center justify-between border-[#f1f1f2] border-t py-2 pr-[10px] pl-4">
        <button
          className="flex items-center gap-2"
          onClick={handleOpenNewProject}
          type="button"
        >
          <FolderPlus className="size-4 text-black" />
          <p className="text-black text-xs tracking-[-0.36px]">Add Project</p>
        </button>

        <div className="flex items-center gap-4">
          <a
            aria-label="Open docs"
            className="flex size-4 items-center justify-center"
            href="https://nosis.sh/docs"
            rel="noopener"
            target="_blank"
          >
            <OpenBook className="size-4 text-[#808080]" />
          </a>

          <UserAvatarSquare imageUrl={userImage} seed={userSeed} />
        </div>
      </div>
    </div>
  );
}
