# Muppet

Tauri 2 desktop AI chat client for macOS. Rust backend, Svelte frontend (planned).

## Build

```bash
bun install
bun run tauri dev     # dev mode
bun run tauri build   # production
```

Rust backend compiles on `cargo tauri dev` automatically. Frontend is Vite on port 1420.

## Project Structure

- `src-tauri/src/lib.rs` — Tauri app builder, plugin init, DB pool setup
- `src-tauri/src/db.rs` — Versioned migration runner
- `src-tauri/src/error.rs` — `AppError` enum (thiserror-based, Serialize for IPC)
- `src-tauri/src/commands.rs` — All IPC command handlers
- `src/` — Frontend (Svelte + TypeScript, minimal for now)

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
