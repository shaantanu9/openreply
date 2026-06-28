# Evidence tab — 1 SQL instead of 4; tuned cache TTLs; roadmap file

**Date:** 2026-04-19
**Type:** Fix (performance) + Documentation

## Summary

Evidence tab previously fired four separate `api.getFindings` calls, each spawning its own Python process. Replaced with a single parameterized SQL using a CTE + `ROW_NUMBER() OVER (PARTITION BY kind)` to return the top 100 of each of the four kinds (`painpoint`, `feature_wish`, `product`, `workaround`) in one round-trip. The same SQL string is hoisted so the mount-time preload warms the exact cache key the tab-click will hit — first click paints from memory, zero spawns.

Also tuned every cache TTL in `api.js` to reflect how often the underlying data realistically changes (writes already invalidate; TTLs just control how stale a read-only hit can get). Added `docs/openreply-roadmap.md` as the tracking document for every remaining performance optimization and feature idea, with done / remaining check-marks.

## Changes

### Evidence tab → 1 spawn

- `topic.js` — `loadEvidence()` now runs a single CTE SQL and groups rows by `kind` JS-side. Uses `ROW_NUMBER() OVER (PARTITION BY kind ORDER BY evidence_count DESC, id)` to limit to top-100 per kind.
- Same `combinedFindingsSql` is used by the mount-time preload → shared cache key → first Evidence click paints instantly (was 4× cold spawns before).

### Cache TTLs (api.js)

Tuned per realistic data-change frequency; writes already invalidate, so TTLs just control maximum staleness on a pure read:

| Method | Old TTL | New TTL | Rationale |
|---|---|---|---|
| `cli_info`          | 5 s  | **30 s**  | table counts change only after a collect (invalidated on `collect:done`) |
| `list_topics`       | 5 s  | **30 s**  | same driver |
| `overview_stats`    | 5 s  | **15 s**  | dashboard hero stats; slight freshness preference |
| `byok_status`       | 5 s  | **30 s**  | changes only when user edits keys (which invalidates) |
| `list_exports`      | 5 s  | **30 s**  | changes only after export button (which invalidates) |
| `get_findings`      | 5 s  | **10 s**  | post-collect + `collect:done` invalidates |
| `run_query`         | 5 s  | **10 s**  | all topic queries benefit, same invalidation |
| `app_data_dir`      | 60 s | **300 s** | never changes at runtime |
| `recent_activity`   | 2 s  | 2 s       | unchanged — live feed |
| `list_ollama_models`| 10 s | 10 s      | unchanged |

### Roadmap doc

- New `docs/openreply-roadmap.md` tracks all remaining performance + feature work with done/remaining checkboxes, grouped by phase: Performance · Reliability/UX polish · Features · Developer/ops.

## Expected impact

| Action | Before | After |
|---|---|---|
| Open topic → Evidence tab (cold) | 4 parallel Python spawns | 1 spawn |
| Preload warmed → Evidence tab | 4 spawns | 0 spawns (cache hit) |
| Dashboard re-entry within 30 s | 5 s cache miss → re-spawn | memory hit (30 s TTL) |
| Settings re-entry within 30 s | same | memory hit |

## Files Created

- `docs/openreply-roadmap.md`
- `changelogs/2026-04-19_12_evidence-one-spawn-and-ttls.md` (this file)

## Files Modified

- `app-tauri/src/screens/topic.js` — single combined SQL for Evidence; preload shares the same SQL string
- `app-tauri/src/api.js` — per-method TTLs rebalanced
