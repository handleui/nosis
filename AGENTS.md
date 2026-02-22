# Nosis

Tauri 2 desktop AI chat client for macOS. Turborepo monorepo with Rust backend, Svelte frontend (planned), and a Next.js web client.

## Runtime split
- Web (`apps/web`) owns the app UI and client state.
- Worker (`apps/worker`) owns auth, persistence, chat, and tool wiring.
- Desktop (`apps/desktop`) is a thin Tauri host around the web runtime.
- Shared execution target taxonomy lives in `packages/agent-runtime`.

## Build

```bash
bun install              # install all workspace deps
bun run build            # build all apps via turbo
bun run dev              # dev all apps via turbo

# Single app:
turbo run dev --filter=nosis-desktop
turbo run dev --filter=nosis-worker
turbo run dev --filter=nosis-web

# Tauri desktop specifically:
cd apps/desktop && bun run tauri dev
cd apps/desktop && bun run tauri build
```

Rust backend compiles on `tauri dev` automatically. Frontend is Vite on port 1420.

## Dev URLs (portless)

Both the worker and web apps use [portless](https://github.com/nicepkg/portless) for stable dev URLs (no port conflicts):

- **Worker API**: `http://nosis-api.localhost:1355` (via `portless nosis-api`)
- **Web client**: `http://nosis-web.localhost:1355` (via `portless nosis-web`)
- **Desktop Vite**: `http://localhost:1420` (direct, consumed by Tauri webview — not proxied)

Bypass portless with `PORTLESS=0 bun run dev`.

## Project Structure

- `apps/desktop/` — Tauri desktop app (frontend + Rust backend)
  - `apps/desktop/src/` — Frontend (TypeScript, minimal for now)
  - `apps/desktop/src/main.ts` — Entry point, dev globals, Escape dismiss
  - `apps/desktop/src/api.ts` — Worker API HTTP client (conversations, messages)
  - `apps/desktop/src/mcp-clients.ts` — MCP client connections + tool discovery
  - `apps/desktop/src/mcp-oauth.ts` — OAuth PKCE flow for MCP server auth
  - `apps/desktop/src-tauri/src/lib.rs` — Tauri app builder, plugin init, DB pool setup
  - `apps/desktop/src-tauri/src/db.rs` — Versioned migration runner
  - `apps/desktop/src-tauri/src/error.rs` — `AppError` enum (thiserror-based, Serialize for IPC)
  - `apps/desktop/src-tauri/src/commands.rs` — IPC commands (secrets, placement, arcade, MCP)
  - `apps/desktop/src-tauri/src/arcade.rs` — Arcade AI tool integration
  - `apps/desktop/src-tauri/src/oauth_callback.rs` — OAuth callback server for MCP auth
  - `apps/desktop/src-tauri/src/placement.rs` — Window placement modes
  - `apps/desktop/src-tauri/src/secrets.rs` — Encrypted secret store (iota_stronghold)
  - `apps/desktop/src-tauri/src/util.rs` — String utilities
- `apps/web/` — Next.js web client (React 19)
  - `apps/web/src/lib/auth-client.ts` — Better Auth React client
  - `apps/web/src/components/auth-guard.tsx` — Session guard, redirects to /sign-in
  - `apps/web/src/app/sign-in/page.tsx` — GitHub OAuth sign-in
  - `apps/web/src/app/onboarding/page.tsx` — BYOK API key setup
  - `apps/web/src/app/(chat)/` — Authenticated chat layout + pages
  - `apps/web/src/app/code/` — Code mode layout + pages
- `apps/worker/` — Cloudflare Workers API (Hono)
  - `apps/worker/src/index.ts` — Hono app with auth, CORS, all API routes
  - `apps/worker/src/auth.ts` — Better Auth setup
  - `apps/worker/src/chat.ts` — AI streaming via Letta provider
  - `apps/worker/src/crypto.ts` — AES-GCM encryption for BYOK API keys
  - `apps/worker/src/db.ts` — D1 query functions (conversations, messages, keys)
  - `apps/worker/src/exa.ts` — Exa AI web search
  - `apps/worker/src/firecrawl.ts` — Firecrawl URL extraction
  - `apps/worker/src/keys.ts` — BYOK key resolution (decrypt + lookup)
  - `apps/worker/wrangler.jsonc` — Wrangler config
- `packages/provider/` — `@nosis/provider` — Letta AI SDK wrapper

See `ARCHITECTURE.md` for full details.

## Conventions

### Rust

- All DB access through sqlx with shared `SqlitePool` managed by Tauri state
- Use `query_as` with `RETURNING` instead of separate SELECT after INSERT
- Validate all inputs (UUIDs, lengths, enums) before hitting the database
- Sanitize DB errors — never leak internal details to the frontend
- New migrations go in `db.rs` as the next version number in `versioned_migrations()`
- Use `thiserror` for error types — `AppError` enum in `error.rs`

### Frontend

- Svelte with TypeScript — use `class` and `for` attributes (not `className`/`htmlFor`)
- Call Worker API via `api.ts` HTTP client for data operations (conversations, messages)
- Call Tauri backend via `invoke()` from `@tauri-apps/api/core` for desktop-only features (secrets, placement, MCP, arcade)

### General

- Package manager: **bun** (not pnpm/npm/yarn)
- Keep the binary small — release profile uses LTO + strip
- Commits and PR titles use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)
- Do not edit SQL migration files or Drizzle-generated files (`apps/worker/drizzle/**`) unless explicitly requested

## Code Quality

Ultracite (Biome-based) handles formatting and linting.

```bash
bun x ultracite fix      # format + autofix
bun x ultracite check    # lint check
bun x ultracite doctor   # diagnose setup
```

Run `bun x ultracite fix` before committing.

### TypeScript

- Prefer `unknown` over `any`; leverage type narrowing over type assertions
- Use `as const` for immutable values and literal types
- `const` by default, `let` only when needed, never `var`
- `for...of` over `.forEach()` and indexed loops
- `async/await` over promise chains; always `await` in async functions
- Destructuring for object and array assignments
- Optional chaining (`?.`) and nullish coalescing (`??`) for safer access

### Code Style

- Early returns over nested conditionals
- Extract complex conditions into named booleans
- Keep functions focused; group related code together
- No `console.log`, `debugger`, or `alert` in production
- Throw `Error` objects, not strings
- Prefer specific imports; no barrel files

### Security

- `rel="noopener"` on `target="_blank"` links
- No `eval()` or direct `document.cookie` assignment
- Validate and sanitize user input

### Testing

- Assertions inside `it()` or `test()` blocks
- `async/await` over done callbacks
- No `.only` or `.skip` in committed code
