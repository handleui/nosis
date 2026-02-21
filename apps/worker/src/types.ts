import type { CloudExecutionTarget } from "@nosis/agent-runtime/execution";
import type {
  conversations,
  offices,
  mcpServers,
  messages,
  projects,
  workspaces,
} from "./schema";

// ── Worker Bindings ──

export interface Bindings {
  ENVIRONMENT?: string;
  EXA_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  LETTA_API_KEY?: string;
  ARCADE_API_KEY?: string;
  DB: D1Database;
  KV?: KVNamespace;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

// ── Exa (web search) ──

export type SearchType = "neural" | "fast" | "auto" | "deep";

export type SearchCategory =
  | "company"
  | "research paper"
  | "news"
  | "pdf"
  | "github"
  | "tweet"
  | "personal site"
  | "financial report"
  | "people";

export interface ContentOptions {
  text?: boolean;
}

export interface SearchRequest {
  query: string;
  type?: SearchType;
  category?: SearchCategory;
  numResults?: number;
  contents?: ContentOptions;
}

export interface SearchResult {
  title: string | null;
  url: string;
  publishedDate: string | null;
  author: string | null;
  text: string | null;
  highlights: string[] | null;
  score: number | null;
  id: string;
}

export interface SearchResponse {
  results: SearchResult[];
  requestId: string | null;
}

// ── Firecrawl (URL content extraction) ──

export interface ScrapeRequest {
  url: string;
}

export interface ScrapeResponse {
  markdown: string;
  title: string | null;
  sourceURL: string;
}

// ── Conversations ──

export type Conversation = typeof conversations.$inferSelect;
export type ConversationStoredExecutionTarget =
  (typeof conversations.$inferSelect)["execution_target"];
export type ConversationExecutionTarget = CloudExecutionTarget;

// ── Projects / Workspaces ──

export type Office = typeof offices.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceKind = (typeof workspaces.$inferSelect)["kind"];
export type WorkspaceStatus = (typeof workspaces.$inferSelect)["status"];

// ── Messages ──

export type Message = typeof messages.$inferSelect;

// ── MCP Servers ──

export type McpServer = typeof mcpServers.$inferSelect;
export type McpServerScope = (typeof mcpServers.$inferSelect)["scope"];

// ── GitHub ──

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export interface GithubPR {
  number: number;
  title: string;
  state: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
}

export interface GithubPRDetail extends GithubPR {
  additions: number;
  deletions: number;
  changed_files: number;
  body: string | null;
}

export interface GithubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  app: { name: string; slug: string } | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface GithubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}
