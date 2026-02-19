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

## Phase 3: Move conversation/message CRUD ← current

- D1 database with conversations + messages tables
- REST endpoints mirroring current Tauri IPC commands
- Remove CRUD from `commands.rs`
- Frontend calls Worker instead of `invoke("save_message")`, etc.

## Phase 4: Move AI streaming

- Vercel AI SDK `streamText()` on the Worker
- SSE streaming to clients via Hono's `streamSSE`
- Consider `@cloudflare/ai-chat` if stable (v0.1.0 as of 2026-02-17)
- Remove `streaming.ts` from frontend
- Anthropic/Letta keys stay server-side

## Phase 5: Shrink Rust

- Remove `commands.rs` CRUD, `streaming.ts`
- Rust backend: ~150 lines (placement + hotkey + auth token in Stronghold)
- `lib.rs` bootstraps Tauri with minimal plugins
- CSP updated to allow Worker domain only
