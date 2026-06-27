# Instant load — SWR read cache + skeletons

**Date:** 2026-06-27
**Type:** Performance

## Summary

Every OpenReply screen felt slow (~5s) even though it reads a local SQLite DB.
The cost was not the DB (sub-millisecond) but the Python sidecar: each Tauri
command shells out to the `gapmap` CLI, paying a cold interpreter/import spawn
(~4-5s measured) on every call, and the OpenReply UI had no caching — so every
navigation re-paid those round-trips and showed a bare "Loading…". This adds a
stale-while-revalidate (SWR) read cache so navigation is instant, a router-level
skeleton so first paint is never blank, and a background cache prewarm so even
the first visit to the main screens is fast.

## Changes

- **SWR read cache (`or/api.js`):** read commands (`agent_*`, `reply_list`,
  `reply_drafts`, `content_list`, `persona_agent_list`, `license_*`, etc.) now
  return the last-known result from localStorage instantly and refresh in the
  background. Writes invalidate the affected read families (reply/content also
  bust agent-knowledge counts; agent/persona writes re-scope reply/content) so
  the next read is authoritative. `api.clearCache()` exposed for reset/refresh.
- **Skeletons (`or/skeleton.js`, new):** route-aware `animate-pulse` skeletons
  (`skeletonFor(key)` / `skeletonBody(key)`) — dashboard, list, grid, KPI,
  analytics variants.
- **Router wiring (`main.js`):** show `skeletonFor(key)` on every navigation
  (replaces the bare "Loading…"); fetch the two license-gate signals in
  parallel instead of sequentially; background `prewarm()` of the most-likely
  next screens' reads after the landing screen paints.

## Files Created

- `app-tauri/src/or/skeleton.js` — shared skeleton-screen builders.

## Files Modified

- `app-tauri/src/or/api.js` — SWR read cache + write invalidation + `clearCache`.
- `app-tauri/src/main.js` — router skeleton, parallel license gate, cache prewarm.
