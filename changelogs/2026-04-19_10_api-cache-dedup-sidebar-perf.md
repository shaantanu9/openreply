# Fast sidebar navigation — in-memory cache + in-flight dedup on every idempotent sidecar read

**Date:** 2026-04-19
**Type:** Fix (performance)

## Summary

Each sidebar click used to re-spawn a fresh Python subprocess per query — SQLite is local and fast, but Python startup costs ~300–500 ms in dev (much worse in prod under Gatekeeper), so clicking through 5 screens meant 5+ process spawns even when the data hadn't changed. Replaced every idempotent `api.*` method with a cached variant that memoises the last result in-memory (5 s TTL) and dedupes in-flight callers, with explicit invalidation on write/mutation commands and on `collect:done` events so freshness is preserved.

## Changes

- **In-memory TTL cache** on every idempotent read in `src/api.js`:
  - `cliInfo`, `listTopics`, `overviewStats`, `listExports`, `byokStatus`, `getFindings`, `runQuery` — default 5 s TTL
  - `recentActivity` — 2 s (feels live on Activity screen refresh)
  - `appDataDir` — 60 s (value never changes at runtime)
  - `listOllamaModels` — 10 s
- **In-flight dedup** — if two callers invoke the same cached method simultaneously (e.g. home's background refresh and a sidebar counter), they share one promise so the sidecar is spawned exactly once.
- **Explicit invalidation on writes** — `startCollect`, `buildGraph`, `enrichGraph`, `ingestFile`, `deleteTopic`, `byokSet`, `exportHtml`, `exportReportPro` clear the relevant cache keys so the next read is fresh.
- **Event-driven invalidation** — `onCollectDone` now clears `list_topics`, `overview_stats`, `recent_activity`, `cli_info`, `run_query`, `get_findings` caches automatically so the Dashboard reflects fresh counts after a collect finishes without a manual refresh.
- **`clearApiCache()`** exported for emergencies / tests.
- Cleaned up one remaining inline style in `activity.js` (refresh button → `.btn-sm btn-bordered` utility class).

## Expected impact

| Scenario | Before | After |
|---|---|---|
| First visit to a screen | ~500 ms per query (dev) | same (cold) |
| Re-visit within 5 s | ~500 ms per query | ~0 ms (memory cache hit) |
| 2 components call `listTopics()` in parallel | 2 Python spawns | 1 spawn (in-flight dedup) |
| After `collect:done` fires | stale counts until next manual refresh | auto-invalidated → next read fresh |

## Files Modified

- `app-tauri/src/api.js` — full rewrite with `cachedInvoke()` helper + per-method TTL + invalidation map
- `app-tauri/src/screens/activity.js` — one inline style removed
