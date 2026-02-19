# Nosis Cloud Migration

Migrating from Tauri-only to cloud-first. Tauri remains as a thin desktop shell (window placement, global hotkey). Everything else moves to a Cloudflare Worker.

## Current Architecture

```
Svelte UI (WebView)
    ↓ invoke()
Rust Backend (Tauri)
    ├── SQLite (conversations, messages, settings)
    ├── Stronghold vault (API keys)
    ├── Exa search (HTTP client)
    ├── Placement modes + Alt+Space hotkey
    └── CSP / input validation
    ↓ HTTPS (from WebView)
Letta AI API → Anthropic
```

All AI streaming happens in the frontend via `@letta-ai/vercel-ai-sdk-provider`. Rust backend is CRUD + key vault + window management.

## Target Architecture

```
Any Client (Tauri / Web / iOS)
    ↓ HTTPS
Cloudflare Worker (Hono)
    ├── D1 (conversations, messages, settings)
    ├── Workers Secrets (API keys)
    ├── Exa, fal, ElevenLabs integrations
    └── AI streaming (Vercel AI SDK)
    ↓
Letta / Anthropic / fal / ElevenLabs

Tauri Desktop Shell (kept)
    ├── placement.rs (window modes)
    ├── Global hotkey (Alt+Space)
    └── Stronghold (auth token only)
```

## Phase 1: Scaffold Worker ✓

Stand up the Cloudflare Worker with Hono. Health endpoint, CORS for Tauri, basic project structure. No auth, no database, no AI — just prove the infrastructure works.

**Deliverables:**
- `apps/worker/` — Hono on CF Workers scaffold
- `GET /health` — public health check
- CORS middleware for Tauri WebView + localhost dev
- `wrangler.jsonc` configuration
- This migration doc

**Files:**
- `apps/worker/src/index.ts`
- `apps/worker/wrangler.jsonc`
- `apps/worker/package.json`
- `migration.md` (this file)

## Phase 2: Move Exa search ✓

Move Exa search to the Worker. Server-side secrets replace per-device key configuration.

- `POST /api/search` endpoint on Worker (`apps/worker/src/exa.ts`)
- `EXA_API_KEY` via Workers Secrets (replaces Stronghold vault)
- Removed `exa.rs`, Exa commands, and related error variants from Rust backend
- Rate limiting deferred to auth phase

## Phase 3: Move conversation/message CRUD ✓

D1 database with conversations + messages tables. REST endpoints mirror Tauri IPC commands exactly (same validation rules, same error semantics).

**Deliverables:**
- `migrations/0001_initial_schema.sql` — conversations + messages tables, FK cascade, indexes
- `src/db.ts` — 8 query functions (create/list/get/update/delete conversation, set agent, get/save message)
- `src/validate.ts` — input validators mirroring Rust rules (UUID, title, role, content, pagination, agent ID)
- `src/types.ts` — Conversation + Message interfaces
- `wrangler.jsonc` — D1 binding (`DB` → `nosis-db`)
- 8 REST endpoints in `src/index.ts`:
  - `POST /api/conversations` (201)
  - `GET /api/conversations` (paginated)
  - `GET /api/conversations/:id`
  - `PATCH /api/conversations/:id/title`
  - `DELETE /api/conversations/:id` (cascade)
  - `PATCH /api/conversations/:id/agent`
  - `GET /api/conversations/:id/messages` (paginated)
  - `POST /api/conversations/:id/messages` (201)
- CORS updated with PATCH method
- Content-Type enforcement middleware (CSRF defense)
- `parseJsonBody` helper for DRY request parsing

**Not yet done (deferred):**
- Remove CRUD from `commands.rs` (Phase 5)
- Frontend calls Worker instead of `invoke()` (Phase 5)

## Phase 4: Move AI streaming ✓

Letta AI as the sole provider, streaming through the Worker. Agent-per-conversation with server-side memory.

**Deliverables:**
- `packages/provider/` — shared `@nosis/provider` package wrapping `@letta-ai/vercel-ai-sdk-provider`
  - `createProvider(apiKey)` — creates Letta provider
  - `createAgent(provider, conversationId)` — creates agent with Nosis defaults (persona, memory blocks)
  - Constants: `DEFAULT_MODEL`, `DEFAULT_CONTEXT_WINDOW`, `DEFAULT_PERSONA`, `DEFAULT_HUMAN`
- `apps/worker/src/chat.ts` — streaming endpoint logic
  - Creates Letta agent on first chat, stores `letta_agent_id` in D1
  - Atomic agent creation (race-condition safe)
  - Orphan cleanup on D1 save failure
  - Streams via `result.toTextStreamResponse()` with CF Workers headers
  - Persists user + assistant messages to D1 (cache for fast reads)
- `POST /api/conversations/:id/chat` route in `src/index.ts`
  - Accepts `{ content: string }` — only the latest user message (Letta manages history)
  - `LETTA_API_KEY` in Workers Secrets
- No `@ai-sdk/anthropic` or `@cloudflare/ai-chat` — Letta handles Anthropic routing

**Not yet done (deferred):**
- Remove `streaming.ts` and `letta.ts` from frontend (Phase 5)
- Frontend consuming Worker stream (Phase 5)
- MCP tools on the Worker (future)

## Phase 5: Shrink Rust

- Remove `commands.rs` CRUD, `streaming.ts`
- Rust backend: ~150 lines (placement + hotkey + auth token in Stronghold)
- `lib.rs` bootstraps Tauri with minimal plugins
- CSP updated to allow Worker domain only
