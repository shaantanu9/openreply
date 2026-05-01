# Topic-open perf — localStorage SWR for the read-only stats spawns

**Date:** 2026-05-01
**Type:** Fix

## Summary

Even with Fix #1, opening a topic still spawned the Python sidecar 3 times: `topic_saturation`, `topic_coverage_gaps`, and `byok_status`. Each spawn pays Python interpreter / PyInstaller startup (~300–800 ms warm, 1–2 s cold on bundled DMG). These three calls return tiny read-only stats that don't change between sessions — perfect candidates for cross-session localStorage persistence with stale-while-revalidate. Now the next topic-page open after the very first one resolves these three calls from disk in microseconds instead of paying three sidecar spawns.

## Changes

- Added `readPersisted()` / `writePersisted()` helpers backed by `localStorage` under prefix `gapmap.api.cache.`.
- Extended `cachedInvoke` and `cachedFetch` with an optional `persistTtlMs` arg. When set:
  - On a memory-cache miss, if a persisted entry is fresh, hydrate `_cache` from it AND return immediately. Kick off a background fetch that updates both layers — caller gets instant paint without blocking.
  - On a fresh fetcher resolve, mirror the value to localStorage too.
- Extended `invalidate()` to wipe matching `localStorage` entries alongside in-memory `_cache`. So `mutated('hypothesis')`, `mutated('byok')`, `mutated('collect' | 'graph' | 'findings' | 'ingest')` continue to be the single source of truth — they now clear both layers in one call. No new wiring required at write sites.
- Opted in:
  - `byokStatus` — 60 s in-memory, 30 min persist.
  - `topicSaturation` — 60 s in-memory, 10 min persist.
  - `topicCoverageGaps` — 60 s in-memory, 10 min persist.
  - `hypothesisStats` (native run_query, from Fix #1) — 60 s in-memory, 10 min persist.

## Files Modified

- `app-tauri/src/api.js` — added `PERSIST_PREFIX` + persist helpers, threaded `persistTtlMs` into `cachedInvoke` / `cachedFetch`, taught `invalidate()` to wipe localStorage too, opted in 4 callers.
