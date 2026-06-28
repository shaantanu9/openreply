# Tab performance — native rusqlite fast-paths for Insights / Papers / Bets / Solutions / counts

**Date:** 2026-05-01
**Type:** Performance

## Summary

Diagnosed why topic tabs felt slow despite local SQLite, then ported the
remaining hot read paths from the Python sidecar to native rusqlite. The
common pattern: tabs that "just SELECT some rows" were paying full Python
process spawn + JSON-encode latency on every open. This change collapses
that to ~1 ms per call.

A new `docs/TAB_PERFORMANCE.md` writeup covers the root cause, the fixes,
and a per-tab loader status table.

## Root cause

Three issues compounded:

1. Every "read" went through the Python sidecar — even ones that were
   one SELECT against `reddit.db`. Production DMG users ate cold-start
   latency (500–2000 ms) on every call. Dev users had a warm-Python
   daemon (`cli.rs:158-228`) but still paid IPC framing (~10–30 ms).
2. Topic page mount fired ~15 sidecar calls in parallel
   (prefetches + freshness badges + topic stats + saturation + coverage).
3. 11 freshness badges polled at 1 Hz = 11 sidecar pings / second
   competing with real tab loads for the IPC pipe.

## Fixes shipped

### Native rusqlite fast-paths (Rust)
- `commands::topic_insights_cached` — cached Insights report, was ~1 SELECT through Python.
- `commands::topic_counts_bundle` — replaces 11 freshness-badge `runQuery` calls with one rusqlite roundtrip returning every count for a topic.
- `commands::papers_list_native` — Papers tab list (with arXiv `pdf_url` derivation + LEFT JOIN on `paper_full_texts` for `has_fulltext` flag).
- `commands::hypothesis_list_native` — Bets tab list (with the same `_hydrate` step Python did inline: `card_json` → `card`, `linked_evidence` → `evidence`).
- `commands::solutions_data_bundle` — Solutions tab data, was 1 + 2N round-trips (one per painpoint × interventions × papers); now 3 SQL statements stitched into the existing `{ pp, interventions, papers }` shape in one Tauri call.

All commands return `{}` / `[]` gracefully when the relevant table doesn't
exist yet (fresh install, before first collect).

### Frontend wiring
- `api.synthesizeInsights(topic, true)` routes to `topic_insights_cached`.
- `api.papersList` routes to `papers_list_native` (legacy sidecar path stays as `papersListSidecar`).
- `api.hypothesisList` routes to `hypothesis_list_native`.
- `api.solutionsDataBundle` is the new fetch used by `loadSolutions`; the old N+1 `Promise.all(painpoints.map(...))` block is gone.
- `api.topicCountsBundle` drives every freshness badge in `topic.js`; badges share one cached fetch via `cachedInvoke`'s in-flight dedup.

### Cache & poll tuning
- Freshness-badge interval bumped from 1 s → 5 s. Counts only change on user mutations, all of which already invalidate the bundle key.
- `getFindings` TTL bumped from 10 s → 30 s.
- `topic_counts_bundle`, `topic_insights_cached`, `papers_list_native`, `hypothesis_list_native`, `solutions_data_bundle` all added to the relevant `INVALIDATE_MAP` entries (topics / collect / ingest / graph / findings / hypothesis) so writes wipe stale cache automatically.

## Files Created

- `docs/TAB_PERFORMANCE.md`
- `changelogs/2026-05-01_06_tab-perf-native-fast-paths.md`

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — added 5 native commands: `topic_insights_cached`, `topic_counts_bundle`, `papers_list_native`, `hypothesis_list_native`, `solutions_data_bundle`.
- `app-tauri/src-tauri/src/main.rs` — registered the 5 new handlers.
- `app-tauri/src/api.js` — wired the natives, exposed `topicCountsBundle` / `solutionsDataBundle` / `papersListSidecar`, extended `INVALIDATE_MAP` for the new cache keys, bumped TTLs.
- `app-tauri/src/lib/tabPipelines.js` — added `tabCountFromBundle` adapter so freshness badges share one bundle.
- `app-tauri/src/screens/topic.js` — replaced 11 per-badge `runQuery` lambdas with one shared `bundleGetCount`; bumped poll interval to 5 s.
- `app-tauri/src/screens/solutions.js` — replaced N+1 painpoint × {interventions, papers} fetch with a single `solutionsDataBundle` call.

## Verification

- `cargo check` clean on Tauri side.
- `node --check` clean on every touched JS file.
- Smoke test: `papers_list_native`, `hypothesis_list_native`, `solutions_data_bundle` all return well-formed shape on a populated dev DB.
- Source filter for papers matches `ACADEMIC_SOURCES` in `paper_export.py` exactly: `arxiv, pubmed, openalex, scholar, semantic_scholar, crossref`.
- Bets renderer's `row.card.<field>` contract preserved — native command hydrates `card_json` → `card` exactly the way Python's `_hydrate` did.

## Expected user-visible impact

- **Insights / Papers / Bets / Solutions tabs**: ~95% faster mount on
  warm cache, ~99% faster on cold DMG.
- **Topic page mount**: 15 sidecar IPC calls → 3.
- **Idle traffic on a topic page**: 11 pings/sec → 0.2 pings/sec.
- **Tab revisit within 30 s**: served from in-memory cache, zero IPC.
