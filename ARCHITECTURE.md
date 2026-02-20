# Nosis Architecture

Aggressively performant AI chat client for macOS. Turborepo monorepo with a Tauri 2 desktop app (Rust backend + Svelte frontend planned) and a Cloudflare Workers API.

## Directory Layout

```
nosis/
├── apps/
│   ├── desktop/               # Tauri desktop app
│   │   ├── src/               # Frontend (TypeScript, served by Vite)
│   │   │   ├── main.ts        # Entry point — dev globals, Escape dismiss
│   │   │   ├── api.ts         # Worker API HTTP client (conversations, messages)
│   │   │   ├── mcp-clients.ts # MCP client connections + tool discovery
│   │   │   └── mcp-oauth.ts   # OAuth PKCE flow for MCP server auth
│   │   ├── src-tauri/         # Backend (Rust)
│   │   │   ├── src/
│   │   │   │   ├── main.rs          # Binary entry — calls nosis_lib::run()
│   │   │   │   ├── lib.rs           # Tauri builder, plugin setup, DB pool init
│   │   │   │   ├── db.rs            # Versioned migration runner
│   │   │   │   ├── error.rs         # AppError enum (thiserror + Serialize for IPC)
│   │   │   │   ├── commands.rs      # Tauri IPC commands (secrets, placement, arcade, MCP)
│   │   │   │   ├── arcade.rs        # Arcade AI tool integration
│   │   │   │   ├── oauth_callback.rs # OAuth callback server for MCP auth
│   │   │   │   ├── placement.rs     # Window placement modes
│   │   │   │   ├── secrets.rs       # Encrypted secret store (iota_stronghold)
│   │   │   │   └── util.rs          # String utilities
│   │   │   ├── capabilities/
│   │   │   │   └── default.json # Tauri permission grants for the main window
│   │   │   ├── Cargo.toml      # Rust deps
│   │   │   └── tauri.conf.json # Tauri config (build commands, CSP, window, plugins)
│   │   ├── package.json        # Desktop app deps + scripts
│   │   ├── vite.config.ts      # Vite dev server + build config
│   │   └── tsconfig.json       # TypeScript config
│   └── worker/                # Cloudflare Workers API
│       ├── src/
│       │   ├── index.ts       # Hono app — routes, CORS, auth, body limits
│       │   ├── auth.ts        # Better Auth setup
│       │   ├── chat.ts        # AI streaming via Letta provider
│       │   ├── db.ts          # D1 query functions (conversations, messages)
│       │   ├── exa.ts         # Exa AI web search
│       │   ├── firecrawl.ts   # Firecrawl URL extraction
│       │   ├── middleware.ts   # Session + auth middleware
│       │   ├── sanitize.ts    # Error/secret sanitization
│       │   ├── schema.ts      # Drizzle ORM schema
│       │   ├── types.ts       # Shared TypeScript types
│       │   └── validate.ts    # Input validators
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.jsonc
├── packages/
│   └── provider/              # @nosis/provider — Letta AI SDK wrapper
├── package.json               # Monorepo root (workspaces, turbo delegation)
├── turbo.json                 # Task orchestration
└── biome.jsonc                # Shared lint/format config (Ultracite)
```

## Backend (Rust / Tauri)

The Rust backend is a thin desktop shell focused on window management, hotkeys, local secret storage, Arcade AI tools, and MCP server management. Conversation/message CRUD and AI streaming are handled by the Worker API.

### Database — SQLite via sqlx 0.8

- **Location**: `~/.local/share/com.nosis.app/nosis.db`
- **Pool**: 2 connections (1 writer + 1 reader under WAL)
- **PRAGMAs**: WAL journal, synchronous=NORMAL, 64MB cache, memory temp_store, 256MB mmap
- **Migrations**: Hand-rolled versioned system in `db.rs`. Each version is a `(i64, Vec<&str>)` applied once inside a transaction, tracked in `schema_version` table.
- **Note**: Conversation/message tables remain in local schema for backward compatibility but are no longer written to by Tauri commands. Active data lives in D1 (Worker).

### IPC Commands

All commands go through `tauri::command` and are callable from the frontend via `invoke()`.

| Command | Description |
|---|---|
| `store_api_key` | Store encrypted API key by provider name |
| `get_api_key` | Retrieve API key by provider name |
| `has_api_key` | Check if API key exists |
| `delete_api_key` | Remove API key |
| `set_placement_mode` | Set window placement mode |
| `get_placement_mode` | Get current placement mode |
| `dismiss_window` | Hide main window |
| `arcade_set_config` | Configure Arcade AI integration |
| `arcade_get_config` | Get Arcade config status |
| `arcade_delete_config` | Remove Arcade config |
| `arcade_list_tools` | List available Arcade tools |
| `arcade_authorize_tool` | Start Arcade tool authorization |
| `arcade_check_auth_status` | Check Arcade auth status |
| `arcade_execute_tool` | Execute an Arcade tool |
| `add_mcp_server` | Register an MCP server |
| `list_mcp_servers` | List registered MCP servers |
| `delete_mcp_server` | Remove an MCP server |
| `start_oauth_callback_server` | Start OAuth callback for MCP auth |
| `shutdown_oauth_session` | Clean up OAuth session |

### Security

- **Secret Store**: Custom encrypted store backed by iota_stronghold with Argon2 KDF. Salt file at `{app_data}/salt.txt`.
- **CSP**: Locked down — self-only with wasm-unsafe-eval for script, unsafe-inline for style, ipc: for Tauri bridge, https://*.workers.dev for Worker API (to be pinned to exact production URL).
- **Input validation**: UUID format checks, length limits, URL validation. DB errors are sanitized before reaching frontend.

### Global Hotkey

`Alt+Space` toggles main window visibility (show/hide + focus).

## Worker API (Cloudflare Workers / Hono)

The Worker handles all data operations and AI streaming. Authenticated via Better Auth.

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| * | `/api/auth/*` | Better Auth (login, signup, session) |
| POST | `/api/search` | Exa AI web search |
| POST | `/api/extract` | Firecrawl URL content extraction |
| POST | `/api/conversations` | Create conversation |
| GET | `/api/conversations` | List conversations (paginated) |
| GET | `/api/conversations/:id` | Get conversation |
| PATCH | `/api/conversations/:id/title` | Update title |
| PATCH | `/api/conversations/:id/agent` | Set Letta agent ID |
| DELETE | `/api/conversations/:id` | Delete conversation (cascade) |
| GET | `/api/conversations/:id/messages` | Get messages (paginated) |
| POST | `/api/conversations/:id/messages` | Save message |
| POST | `/api/conversations/:id/chat` | Stream AI chat via Letta |

## Frontend (TypeScript / Vite)

Svelte UI is planned. Current modules:

- `main.ts` — Entry point; Escape dismiss handler; exposes `window.__nosis_api` and `window.__nosis_invoke` in dev mode
- `api.ts` — Typed HTTP client for Worker API (conversations, messages). Supports Bearer auth tokens.
- `mcp-clients.ts` — MCP client connections, tool discovery, and aggregation
- `mcp-oauth.ts` — OAuth PKCE flow for authenticating with MCP servers

**Dev server**: `localhost:1420`, HMR enabled. **Build target**: ES2021.

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
