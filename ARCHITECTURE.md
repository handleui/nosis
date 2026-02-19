# Muppet Architecture

Aggressively performant AI chat client for macOS. Turborepo monorepo with a Tauri 2 desktop app (Rust backend + Svelte frontend planned) and a Cloudflare Workers API.

## Directory Layout

```
muppet/
├── apps/
│   ├── desktop/               # Tauri desktop app
│   │   ├── src/               # Frontend (Svelte + TypeScript, served by Vite)
│   │   │   ├── main.ts        # Entry point — Tauri IPC bridge
│   │   │   └── streaming.ts   # AI SDK + Anthropic streaming chat
│   │   ├── src-tauri/         # Backend (Rust)
│   │   │   ├── src/
│   │   │   │   ├── main.rs        # Binary entry — calls muppet_lib::run()
│   │   │   │   ├── lib.rs         # Tauri builder, plugin setup, DB pool init
│   │   │   │   ├── db.rs          # Versioned migration runner
│   │   │   │   ├── error.rs       # AppError enum (thiserror + Serialize for IPC)
│   │   │   │   ├── commands.rs    # Tauri IPC command handlers (CRUD + hotkey)
│   │   │   │   ├── exa.rs         # Exa AI web search integration
│   │   │   │   ├── placement.rs   # Window placement modes
│   │   │   │   ├── supermemory.rs # Supermemory persistent chat memory
│   │   │   │   └── vault.rs       # Stronghold vault helpers
│   │   │   ├── capabilities/
│   │   │   │   └── default.json # Tauri permission grants for the main window
│   │   │   ├── Cargo.toml      # Rust deps
│   │   │   └── tauri.conf.json # Tauri config (build commands, CSP, window, plugins)
│   │   ├── package.json        # Desktop app deps + scripts
│   │   ├── vite.config.ts      # Vite dev server + build config
│   │   └── tsconfig.json       # TypeScript config
│   └── worker/                # Cloudflare Workers API
│       ├── src/
│       │   └── index.ts       # Hono app with CORS, health endpoint
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.jsonc
├── packages/                  # Shared libraries (future)
├── package.json               # Monorepo root (workspaces, turbo delegation)
├── turbo.json                 # Task orchestration
└── biome.jsonc                # Shared lint/format config (Ultracite)
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

Svelte UI is planned. Current modules:

- `main.ts` — IPC bridge entry point; exposes `window.__muppet_invoke()` in dev mode
- `streaming.ts` — AI SDK + Anthropic streaming chat with abort support, token usage tracking, and API key redaction

- **Dev server**: `localhost:1420`, HMR enabled
- **Build target**: ES2021 (Tauri's WebKit/Chromium baseline)

## Build & Run

```bash
bun install                    # Install all workspace deps
bun run build                  # Build all apps via turbo
bun run dev                    # Dev all apps via turbo

# Desktop app:
cd apps/desktop && bun run tauri dev    # Dev mode (hot reload frontend + Rust rebuild)
cd apps/desktop && bun run tauri build  # Production build

# Worker:
cd apps/worker && bun run dev           # Wrangler dev server
cd apps/worker && bun run deploy        # Deploy to Cloudflare
```

## Release Profile

LTO enabled, opt-level=s, single codegen unit, symbols stripped — optimized for small binary size.
