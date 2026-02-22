# Nosis Architecture

Nosis is a Turborepo monorepo with three active runtime surfaces:

- `apps/desktop` — Tauri desktop shell for macOS (wraps the web client)
- `apps/web` — Next.js 16 web client (React 19)
- `apps/worker` — Cloudflare Worker API (Hono + D1 + Better Auth)

The system is now web/worker-first. Desktop is a thin host around the web runtime.

## Topology

1. UI runs in Next.js (`apps/web`) and talks to Worker HTTP APIs.
2. Worker (`apps/worker`) handles auth, persistence, chat streaming, MCP tool wiring, and GitHub actions.
3. Desktop (`apps/desktop`) opens the web client in a Tauri webview and keeps native packaging/simple shell capabilities.

## Monorepo Layout

```text
apps/
  desktop/
    src/
      main.ts            # minimal desktop placeholder UI
      styles.css
    src-tauri/
      src/lib.rs         # minimal Tauri builder (opener plugin)
      src/main.rs
      tauri.conf.json    # webview points to nosis-web.localhost in dev
  web/
    src/
      app/
        (app)/           # authenticated app shell
          layout.tsx     # AuthGuard + CodeWorkspaceProvider + shared split layout
          (chat)/        # chat mode routes
          code/          # code mode routes
      components/
        code-sidebar.tsx
        code-workspace-provider.tsx
        github-controls-panel.tsx
        resizable-grid.tsx
      hooks/
        use-conversations.ts
        use-nosis-chat.ts
        use-github-controls.ts
      lib/
        worker-api.ts
        git-ops.ts
        git-workspace-runtime.ts
  worker/
    src/
      index.ts           # Hono routes + middleware + error handling
      auth.ts            # Better Auth setup (GitHub OAuth)
      middleware.ts      # session/auth helpers + GitHub token access
      db.ts              # D1 query layer
      schema.ts          # Drizzle schema
      chat.ts            # AI streaming + MCP tool loading
      mcp.ts             # MCP client discovery/connection by execution target
      github.ts          # typed GitHub REST wrapper + conflict normalization
      validate.ts        # request/input validation
      sanitize.ts        # secret redaction
    drizzle/
      *.sql              # generated migrations
      meta/*.json        # generated snapshots/journal
packages/
  provider/              # @nosis/provider (Letta provider wrapper)
  ui/                    # shared UI components
```

## Desktop Runtime (`apps/desktop`)

Current desktop architecture is intentionally minimal:

- Tauri starts with `tauri::Builder::default()` and the opener plugin only.
- Dev webview URL points at `http://nosis-web.localhost:1355`.
- Frontend entry (`src/main.ts`) renders a wrapper placeholder.

This branch removes prior desktop Rust subsystems (local DB, secret store, window-placement commands, Arcade/MCP IPC) in favor of Worker-based capabilities.

## Web App Architecture (`apps/web`)

### Route Model

- Root layout (`app/layout.tsx`) sets fonts/theme globals.
- Authenticated shell lives under `app/(app)/layout.tsx`.
- Chat mode:
  - `/(app)/(chat)` home
  - `/(app)/(chat)/chat/[id]` conversation
- Code mode:
  - `/(app)/code` home
  - `/(app)/code/new` new project/workspace flow
  - `/(app)/code/[id]` code conversation + GitHub control panel

### Shared Client State

`CodeWorkspaceProvider` centralizes:

- conversation list (sandbox-targeted)
- project/workspace catalog
- selected project/workspace persistence via `localStorage`
- create flows for project/workspace/conversation

### API Layer

`src/lib/worker-api.ts` provides typed wrappers for:

- conversations/messages/chat
- projects/workspaces
- GitHub repos/branches/PRs

All requests use cookie credentials and centralized `ApiError` mapping.

## Worker Architecture (`apps/worker`)

### Middleware and Security

- `secureHeaders()` enabled globally.
- CORS restricted to trusted origins (`tauri://localhost`, local dev origins in development).
- JSON content-type guard on mutating requests.
- `sessionMiddleware` resolves Better Auth session.
- `requireAuth` enforced for `/api/*` routes.

### Core Capability Areas

1. Auth and session routes
- `/api/auth/*`

2. BYOK key management
- `/api/keys/:provider` (`PUT`, `DELETE`)
- `/api/keys` (`GET`)

3. External retrieval tools
- `/api/search` (Exa)
- `/api/extract` (Firecrawl)

4. MCP server management
- `/api/mcp/servers` (`POST`, `GET`)
- `/api/mcp/servers/:id` (`DELETE`)

5. Arcade integration
- `/api/arcade/tools`
- `/api/arcade/tools/:name/authorize`
- `/api/arcade/auth/:id/status`

6. GitHub integration
- repos listing
- branch listing/creation
- PR listing/creation/detail

7. Project/workspace model
- `/api/projects` (`POST`, `GET`)
- `/api/workspaces` (`POST`, `GET`)
- `/api/workspaces/:id` (`GET`)

8. Conversation and chat runtime
- conversation CRUD + metadata updates (title/agent/execution target/workspace)
- message list/create
- streamed chat endpoint

### Chat Execution Model

`streamChat()` flow:

1. Resolve conversation runtime (`letta_agent_id`, `execution_target`).
2. Create/claim Letta agent atomically (race-safe).
3. Save user message.
4. Load active MCP tools based on execution target scopes.
5. Stream model output.
6. Persist assistant response and cleanup MCP clients after stream completion.

### MCP Scope Behavior

Execution target to MCP scopes is currently sandbox-only:

- `sandbox` -> `global`, `sandbox`

### Execution Surfaces

Shared target taxonomy is defined in `@nosis/agent-runtime`:

- cloud/worker: `sandbox`
- desktop (planned runtime): `sandbox`, `local`

Current guardrails:

- Worker chat validation remains sandbox-only.
- Web conversation hooks default to sandbox filtering.
- Local desktop execution remains out-of-scope for this PR.
- Web and validation layers consume taxonomy from `@nosis/agent-runtime/execution`
  (no provider/runtime coupling).

### Responsibility Split (Worker vs Web vs Shared)

Actionable ownership boundaries:

- Worker owns:
  - authoritative execution-target validation/canonicalization
  - agent lifecycle and stream orchestration
  - tool loading policy + key/secret resolution
  - office ownership/persistence integrity guarantees
  - code locations: `apps/worker/src/validate.ts`, `apps/worker/src/chat.ts`, `apps/worker/src/runtime-adapter.ts`, `apps/worker/src/mcp.ts`, `apps/worker/src/db.ts`
- Web owns:
  - route/view semantics (`chat` vs `code`)
  - request shaping and optimistic state
  - default sandbox filtering for conversations
  - code locations: `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/features/chat/hooks/use-conversations.ts`
- Desktop owns (planned runtime):
  - local execution environment + filesystem bridge
  - desktop-only capability adapters
  - code location target: `apps/desktop/**`
- Shared package owns:
  - execution taxonomy (`@nosis/agent-runtime/execution`)
  - runtime adapter contracts (`@nosis/agent-runtime/contracts`)
  - shared agent primitives that are environment-agnostic
  - code locations: `packages/agent-runtime/src/execution.ts`, `packages/agent-runtime/src/contracts.ts`, `packages/agent-runtime/src/agent-id.ts`, `packages/agent-runtime/src/index.ts`

Cross-boundary rules:

- Worker must not depend on UI route semantics.
- Web must not own execution authority or key/secret resolution.
- Shared package must not perform direct DB/network side effects tied to a specific app surface.

## Data Model (D1 + Drizzle)

Primary app tables:

- `projects`
  - office-owned (`office_id` required)
- `workspaces`
- `conversations` (`execution_target` is sandbox-only, `office_id` is required, `workspace_id` optional)
- `messages`
- `mcp_servers`
- `user_api_keys`

Auth tables are managed via Better Auth schema.

## GitHub Controls Path

Web UI (`github-controls-panel` + `use-github-controls`) calls Worker GitHub endpoints through `worker-api.ts`.

Runtime abstraction in `git-workspace-runtime.ts` supports:

- remote branch/PR flows for web/cloud workspaces
- local commit/push is intentionally not available in the web runtime

## Build and Dev

- Package manager: `bun`
- Monorepo task orchestration: `turbo`
- Dev entrypoints:
  - `bun run dev` -> web + worker
  - `bun run dev:desktop` -> desktop shell
  - `bun run dev:all` -> all apps

Portless dev URLs:

- Worker API: `http://nosis-api.localhost:1355`
- Web app: `http://nosis-web.localhost:1355`

## Guardrails

- Do not hand-edit Drizzle generated artifacts in `apps/worker/drizzle/**` unless explicitly requested.
- Import runtime primitives through explicit subpaths (`@nosis/agent-runtime/execution`, `@nosis/agent-runtime/contracts`, `@nosis/agent-runtime/agent-id`) instead of the runtime root package.
- Keep API-side validation strict (`validate.ts`) and sanitize error surfaces (`sanitize.ts`).
