# Nosis

Tauri 2 desktop AI chat client for macOS. Turborepo monorepo with Rust backend, Svelte frontend (planned).

## Build

```bash
bun install              # install all workspace deps
bun run build            # build all apps via turbo
bun run dev              # dev all apps via turbo

# Single app:
turbo run dev --filter=nosis-desktop
turbo run dev --filter=nosis-worker

# Tauri desktop specifically:
cd apps/desktop && bun run tauri dev
cd apps/desktop && bun run tauri build
```

Rust backend compiles on `tauri dev` automatically. Frontend is Vite on port 1420.

## Project Structure

- `apps/desktop/` — Tauri desktop app (frontend + Rust backend)
  - `apps/desktop/src/` — Frontend (Svelte + TypeScript, minimal for now)
  - `apps/desktop/src-tauri/src/lib.rs` — Tauri app builder, plugin init, DB pool setup
  - `apps/desktop/src-tauri/src/db.rs` — Versioned migration runner
  - `apps/desktop/src-tauri/src/error.rs` — `AppError` enum (thiserror-based, Serialize for IPC)
  - `apps/desktop/src-tauri/src/commands.rs` — All IPC command handlers
  - `apps/desktop/src-tauri/src/arcade.rs` — Arcade AI tool integration
  - `apps/desktop/src-tauri/src/fal.rs` — Fal.ai image generation client
  - `apps/desktop/src-tauri/src/oauth_callback.rs` — OAuth callback server for MCP auth
  - `apps/desktop/src-tauri/src/placement.rs` — Window placement modes
  - `apps/desktop/src-tauri/src/secrets.rs` — Encrypted secret store (replaces Stronghold vault)
  - `apps/desktop/src-tauri/src/vault.rs` — Stronghold vault helpers
- `apps/worker/` — Cloudflare Workers API (Hono)
  - `apps/worker/src/index.ts` — Hono app with CORS, health, and Exa search endpoint
  - `apps/worker/src/exa.ts` — Exa AI web search validation and client
  - `apps/worker/src/types.ts` — Shared TypeScript types for Exa search
  - `apps/worker/wrangler.jsonc` — Wrangler config
- `packages/` — Shared libraries (future)

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
- Call backend via `invoke()` from `@tauri-apps/api/core`

### General

- Package manager: **bun** (not pnpm/npm/yarn)
- Keep the binary small — release profile uses LTO + strip
- Commits and PR titles use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)

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
