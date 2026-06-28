# Cache audit — fix SWR-persist staleness gaps introduced in Wave 1

**Date:** 2026-05-31
**Type:** Fix

## Summary

Full audit of every cache layer after the tab-load perf work (Wave 1 SWR
persistence + Wave 2 native rusqlite ports). Cross-referenced every
SWR-persisted read (`cachedInvoke` with a `persistTtlMs`) against the set of
`invalidate()` calls to find persisted reads that can go stale because their
mutation never drops the cache. The 7-day persist window added in Wave 1 turned
small (≤10s) staleness windows into multi-day ones for any read whose mutation
wasn't wired to invalidate it.

## Findings & fixes

- **`list_experiments`** — Wave 1 added a 7-day persist but no mutation
  invalidated it. `experimentPlanGenerate` (which writes the `experiments`
  table) now calls `invalidate('list_experiments')`. (Note: this api method is
  not currently consumed by any screen, so the gap was latent — fixed for
  correctness/hygiene.)
- **`product_get`** — aggregates `open_signal_count` / `competitor_count`
  (computed from `product_signals` / `product_competitors`). `productSweep` and
  `productSignalAction` change those counts but only invalidated
  `product_signals` / `product_dashboard`. With the new 7-day persist the
  counts could be stale for days. Both mutations now also
  `invalidate('product_get')`.
- **`product_list`** — same aggregate (`open_signal_count` per product). Added
  to the same two invalidations.

## Verified clean (no fix needed)

- **rusqlite connection cache** (`db.rs`) — READ_ONLY WAL + per-statement
  autocommit ⇒ every query gets a fresh read snapshot; the Python sidecar's
  committed writes are always visible. No staleness.
- **topic.js tab snapshots** — `openreply:changed` marks tabs dirty
  (`_dirtyTopicTabs`), which bypasses the persisted HTML snapshot on the next
  visit. Coherent.
- **screenCache** — invalidated via the `tagsByKind` → `clearScreenCacheBy`
  map on `openreply:changed`; covers the screens that use it.
- All other persisted aggregates (`interview_summary`, `pmf_score`,
  `vw_aggregate`, `nps_score`, `maxdiff_ranking`, `pert_list`,
  `audience_personas_get`, `launch_brief_get`, `get_findings`,
  `paper_analyses_get`) are invalidated by their mutations.

## Known pre-existing (not changed)

- `topic_saturation`, `topic_coverage_gaps` — persisted with a 10-minute
  window and no explicit invalidation. Advisory coverage hints; the short
  window self-heals. Pre-existing behavior, left as-is.

## Files Modified

- `app-tauri/src/api.js` — invalidation added to `experimentPlanGenerate`,
  `productSweep`, `productSignalAction`.

## Build / verification

- Debug `cargo build` → links clean (20s).
- Release `cargo build --release` → compiles clean **when `JWT_DESKTOP_SECRET`
  is set** (pre-existing requirement; `build.rs` panics without it — set via
  `.env.publish` in `publish-mac.sh`). Verified with a throwaway secret.
- `node --check src/api.js` ✅ · `npm test` → 40/40 pass · `npm run build`
  → built in 1.77s.
