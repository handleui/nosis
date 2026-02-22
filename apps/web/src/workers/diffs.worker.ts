// Re-export @pierre/diffs worker for bundler-compatible Web Worker loading.
// Bundlers (webpack/Turbopack) require a relative path in new URL(..., import.meta.url)
// so we proxy through this local file instead of using the bare specifier directly.
import "@pierre/diffs/worker/worker.js";
