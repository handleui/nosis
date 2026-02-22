import type {
  CloudExecutionTarget,
  DesktopExecutionTarget,
  SharedExecutionTarget,
} from "./execution";

export interface AgentIdRegistry {
  getExistingAgentId: () => Promise<string | null>;
  claimAgentId: (agentId: string) => Promise<boolean>;
  getWinningAgentId: () => Promise<string | null>;
}

export interface MessagePersistence {
  saveUserMessage: (content: string) => Promise<void>;
  saveAssistantMessage: (content: string) => Promise<void>;
}

export interface RuntimeTools {
  tools: Record<string, unknown>;
  cleanup: () => Promise<void>;
}

export interface ToolLoader<
  TExecutionTarget extends SharedExecutionTarget = SharedExecutionTarget,
> {
  loadTools: (executionTarget: TExecutionTarget) => Promise<RuntimeTools>;
}

export interface RuntimeScheduler {
  schedule: (task: Promise<void>) => void;
}

export interface RuntimeErrorReporter {
  onError: (message: string, error: unknown) => void;
}

export interface RuntimeAdapter<
  TExecutionTarget extends SharedExecutionTarget = SharedExecutionTarget,
> extends AgentIdRegistry,
    MessagePersistence,
    ToolLoader<TExecutionTarget>,
    RuntimeScheduler,
    RuntimeErrorReporter {}

export type CloudRuntimeAdapter = RuntimeAdapter<CloudExecutionTarget>;
export type DesktopRuntimeAdapter = RuntimeAdapter<DesktopExecutionTarget>;

export const RESPONSIBILITY_BOUNDARY = {
  worker: {
    owns: [
      "execution target validation and canonicalization",
      "agent lifecycle and stream orchestration",
      "tool policy, key resolution, and secret usage",
      "office ownership and persistence integrity",
    ],
    mustNot: [
      "desktop local file mutation through cloud tools",
      "UI route semantics and view state ownership",
    ],
  },
  web: {
    owns: [
      "route/view semantics for chat vs code threads",
      "request shaping and optimistic client state",
      "default sandbox conversation filtering",
    ],
    mustNot: [
      "execution target authority or server-side policy",
      "secret handling or tool key resolution",
    ],
  },
  desktop: {
    owns: [
      "local environment and filesystem execution context",
      "desktop-only capabilities via native bridge",
    ],
    mustNot: [
      "cloud worker secret storage responsibilities",
      "cloud execution policy authority",
    ],
  },
  shared: {
    owns: [
      "cross-surface execution taxonomy",
      "runtime adapter contracts and reusable primitives",
    ],
    mustNot: [
      "app-specific auth/session models",
      "direct DB/network side effects",
    ],
  },
} as const;
