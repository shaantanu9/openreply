# Tab-load latency — Wave 1: cross-navigation SWR persistence for workspace reads

**Date:** 2026-05-30
**Type:** Fix (performance)

## Summary

"Tabs view — each tab takes time to load." Root cause is partial-adoption
drift, not a missing pattern: the app already has a localStorage SWR layer
(`cachedInvoke`'s 4th `persistTtlMs` arg), native rusqlite reads, and a
daemon-lock timeout — but the workspace route screens (Empathy, Improve /
Launch / Audience, the product-strategy analyses, Interviews, PMF, pricing
surveys, PERT, papers analyses) re-fetched through the Python daemon on
**every** navigation because their `cachedInvoke` calls passed only a short
in-memory TTL (`persistTtlMs = 0`). In-memory cache dies on route change, so
revisiting any of these screens paid a fresh daemon round-trip (200 ms warm,
up to 30-70 s cold on a fresh DMG, serialized behind the daemon mutex).

Wave 1 adds a 7-day SWR persist window to the read-only "build output" reads —
data that changes ONLY on an explicit user build/run. This is safe because
every such mutation already calls `invalidate('<command>')`, which clears both
the in-memory map AND the localStorage mirror, so a stale entry can never
survive a build. Revisits now paint instantly from disk while a background
fetch refreshes.

Deliberately **excluded** volatile status/poll reads (`pipeline_status`,
`iterate_status`, `*_worker_status`, `runtime_snapshot`, collect/stream/chat
status) — a stale "running 3/7" there is worse than slow. Those are addressed
by Wave 2 (native rusqlite port), not persistence.

## Changes

- `api.js`: add `SWR_BUILD_OUTPUT_MS` (7 days) constant + doc comment.
- `api.js`: add the persist window as the 4th `cachedInvoke` arg to 26
  verified-safe read-only reads: `empathy_get/list`, `four_risks_get`,
  `value_curve_get`, `tam_sam_som_get`, `porter_get`, `positioning_get`,
  `cost_model_get`, `interview_get/list/summary`, `pmf_list/score`,
  `vw_aggregate`, `nps_score`, `maxdiff_ranking`, `survey_list`, `pert_list`,
  `audience_personas_get`, `launch_brief_get`, `ost_experiments_list`,
  `paper_analyses_get`, `get_findings`, `list_experiments`,
  `product_list/get`.

## Files Modified

- `app-tauri/src/api.js`

## Verification

- `node --check src/api.js` → OK.
- `npm run build` → built in 1.89s, no errors (only pre-existing dynamic/static
  import-chunking warnings).
- Invalidation audit: every persisted command has a matching
  `invalidate('<command>')` in its mutation path (confirmed via grep).

## Follow-up (Wave 2 — native rusqlite port)

For FIRST-load (and cold-DMG) latency, port the SELECT-shaped get/list/status
commands from `run_cli([...])` to native `query_db` following the existing
`papers_list_native` / `hypothesis_list_native` template — verifying column +
JSON-hydration parity against each Python CLI's SQL. This is the only fix for
the volatile status reads that can't be persisted. Ships via a sidecar/DMG
rebuild. See skill `tauri-python-sidecar-app` Phase 27.
