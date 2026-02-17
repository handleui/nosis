# Muppet Architecture

Aggressively performant AI chat client for macOS. Tauri 2 desktop app with a Rust backend and a Svelte frontend (planned).

## Directory Layout

```
muppet/
├── src/                    # Frontend (Svelte + TypeScript, served by Vite)
│   └── main.ts             # Entry point — Tauri IPC bridge
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── main.rs          # Binary entry — calls muppet_lib::run()
│   │   ├── lib.rs           # Tauri builder, plugin setup, DB pool init
│   │   ├── db.rs            # Versioned migration runner
│   │   ├── error.rs         # AppError enum (thiserror + Serialize for IPC)
│   │   └── commands.rs      # Tauri IPC command handlers (CRUD + hotkey)
│   ├── capabilities/
│   │   └── default.json     # Tauri permission grants for the main window
│   ├── Cargo.toml           # Rust deps
│   └── tauri.conf.json      # Tauri config (build commands, CSP, window, plugins)
├── package.json             # Frontend deps + scripts (bun)
├── vite.config.ts           # Vite dev server + build config
└── tsconfig.json            # TypeScript config
```

## Backend (Rust / Tauri)

### Database — SQLite via sqlx 0.8

- **Location**: `~/.local/share/com.muppet.app/muppet.db`
- **Pool**: 2 connections (1 writer + 1 reader under WAL)
- **PRAGMAs**: WAL journal, synchronous=NORMAL, 64MB cache, memory temp_store, 256MB mmap
- **Migrations**: Hand-rolled versioned system in `db.rs`. Each version is a `(i64, Vec<&str>)` applied once inside a transaction, tracked in `schema_version` table.

#### Schema (v1)

| Table | Purpose |
|---|---|
| `conversations` | id (UUID), title, created_at, updated_at |
| `messages` | id (UUID), conversation_id (FK CASCADE), role, content, model, tokens_in/out, created_at |
| `schema_version` | version (PK), applied_at |

### IPC Commands

All commands go through `tauri::command` and are callable from the frontend via `invoke()`.

| Command | Description |
|---|---|
| `create_conversation` | Insert new conversation, optional title |
| `list_conversations` | Paginated list, ordered by updated_at DESC |
| `update_conversation_title` | Update title by ID |
| `delete_conversation` | Delete conversation + cascade messages |
| `get_messages` | Paginated messages for a conversation |
| `save_message` | Insert message + touch conversation updated_at (transactional) |

### Security

- **Stronghold**: Tauri plugin for encrypted secret storage. Argon2 KDF with salt file at `{app_data}/salt.txt`.
- **CSP**: Locked down — self-only with wasm-unsafe-eval for script, unsafe-inline for style, ipc: for Tauri bridge.
- **Input validation**: UUID format checks, length limits, role whitelist. DB errors are sanitized before reaching frontend.

### Global Hotkey

`Alt+Space` toggles main window visibility (show/hide + focus).

## Frontend (TypeScript / Vite)

Currently minimal — just an IPC bridge. Svelte UI is planned.

- **Dev server**: `localhost:1420`, HMR enabled
- **Build target**: ES2021 (Tauri's WebKit/Chromium baseline)
- **Dev mode**: Exposes `window.__muppet_invoke()` for console testing

## Build & Run

```bash
bun install          # Install frontend deps
bun run tauri dev    # Dev mode (hot reload frontend + Rust rebuild)
bun run tauri build  # Production build
```

## Release Profile

LTO enabled, opt-level=s, single codegen unit, symbols stripped — optimized for small binary size.
