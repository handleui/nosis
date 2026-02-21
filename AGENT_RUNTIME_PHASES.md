# Agent Runtime Phases

This document tracks the architecture migration toward a shared Letta runtime package while keeping desktop execution out-of-scope for now.

## Phase 1 - Sandbox-Only Cloud Execution (in progress)

- Canonicalize worker execution to sandbox semantics.
- Keep legacy `default` input accepted for compatibility, normalize to `sandbox`.
- Load MCP tools using sandbox scopes for all worker chat execution.
- Ensure chat + agent runtime always resolve to an office context (no orphan chats/agents).

## Phase 2 - Shared Agent Runtime Package (started)

- Introduce `@nosis/agent-runtime` for shared runtime primitives:
  - execution target canonicalization (`sandbox`)
  - race-safe Letta agent claim/create helper
  - optional streaming helper scaffold for future runtime adapters
- Wire worker chat orchestration to package primitives without changing chat behavior.

## Phase 3 - Thread Semantics Cleanup (in progress)

- Clarify UI naming: `chatThreads` vs `codeThreads`.
- Split by workspace attachment, not by ambiguous execution labels.
- Keep explicit `workspaceId: null` support so chat threads remain detached from code workspaces.

## Phase 4 - Adapter Boundaries (in progress)

- Define a runtime adapter contract in `@nosis/agent-runtime` for:
  - message persistence
  - tool loading
  - background task scheduling
  - error reporting
- Implemented shared contract module: `@nosis/agent-runtime/contracts`.
- Keep worker as control plane/runtime host for now.
- Defer desktop runtime adapter implementation to a later milestone.

## Phase 4.5 - Execution Surface Taxonomy (in progress)

- Define shared execution-target taxonomy in `@nosis/agent-runtime`:
  - cloud/worker target: `sandbox`
  - desktop-visible targets: `sandbox`, `local`
- Keep worker validation sandbox-only while tolerating legacy `default` input.
- Make web hooks default to sandbox filtering so future desktop-local threads do not leak into web lists.
- Use shared execution constants/types via `@nosis/agent-runtime/execution` and explicit package alias precedence.
- Keep desktop local execution as a follow-up implementation, not part of this PR.

## Phase 5 - Office Ownership Hardening (in progress)

- Backfill legacy conversation rows with missing `office_id` at read/update time.
- Ensure chat runtime always receives a concrete office id before loading tools or resolving keys.
- Keep detached chat threads office-owned (`workspace_id` can be null, `office_id` cannot).
- Remaining: add a DB migration for durable non-null enforcement.
- Remaining: define project/workspace office-null policy and migrate if we want strict org ownership there too.
