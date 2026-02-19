# Muppet

Tauri 2 desktop AI chat client for macOS. Turborepo monorepo with Rust backend, Svelte frontend (planned).

## Build

```bash
bun install              # install all workspace deps
bun run build            # build all apps via turbo
bun run dev              # dev all apps via turbo

# Single app:
turbo run dev --filter=muppet-desktop
turbo run dev --filter=muppet-worker

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
  - `apps/desktop/src-tauri/src/exa.rs` — Exa AI web search integration
  - `apps/desktop/src-tauri/src/placement.rs` — Window placement modes
  - `apps/desktop/src-tauri/src/supermemory.rs` — Supermemory persistent chat memory
  - `apps/desktop/src-tauri/src/vault.rs` — Stronghold vault helpers
- `apps/worker/` — Cloudflare Workers API (Hono)
  - `apps/worker/src/index.ts` — Hono app with CORS, health endpoint
  - `apps/worker/wrangler.jsonc` — Wrangler config
- `packages/` — Shared libraries (future)

See `ARCHITECTURE.md` for full details.

## Conventions

### Rust

- All DB access goes through sqlx with the shared `SqlitePool` managed by Tauri state
- Use `query_as` with `RETURNING` instead of separate SELECT after INSERT
- Validate all inputs (UUIDs, lengths, enums) before hitting the database
- Sanitize DB errors — never leak internal details to the frontend
- New migrations go in `db.rs` as the next version number in `versioned_migrations()`
- Use `thiserror` for error types — `AppError` enum in `error.rs`

### Frontend

- Svelte with TypeScript
- Call backend via `invoke()` from `@tauri-apps/api/core`
- Linting: Ultracite (Svelte preset)

### General

- Package manager: **bun** (not pnpm/npm/yarn)
- No ESLint config — using Ultracite instead
- Keep the binary small — release profile uses LTO + strip
