# Every LLM output is now persisted — no more re-running to see the same result

**Date:** 2026-04-20
**Type:** Feature / Perf

## Summary

User asked for every LLM-generated output to be persisted so repeat views don't trigger repeat LLM calls. Audited every `.complete()` call site in the codebase:

| Feature | Call site | Already persisted? |
|---|---|---|
| Gap extraction (painpoints / features / products / DIY) | `gaps.find_gaps` → `upsert_semantic` → `graph_nodes` | ✅ |
| Sentiment per source | `sentiment_by_source` → `graph_nodes` kind `source_sentiment` | ✅ |
| Paper abstract analysis | `paper_analyze.analyze_paper` → `paper_analyses` table with `cached:true` return | ✅ |
| Solutions pipeline | `persist_solutions` → `graph_nodes` | ✅ |
| Why (causal explanation) | `why.extract_why_*` → upsert helpers | ✅ |
| Discover (sub discovery) | — | deterministic retrieval; no LLM result to cache |
| Chat | localStorage per topic | ✅ (frontend) |
| **Trends (temporal gaps)** | `gaps.find_temporal_gaps` | ❌ **ephemeral — every tab view re-ran the 30–90 s LLM pass** |

The single gap was Trends. Fixed.

## Changes

### `src/reddit_research/research/gaps.py`

Three new helpers + `force` flag on `find_temporal_gaps`:

**`_persist_temporal_gaps(topic, items)`** — upserts each classified painpoint as a `kind='temporal_gap'` `graph_node` row. The label column stores the painpoint text; everything else (classification CHRONIC/EMERGING/FADING, `pre_2025_freq`, `post_2025_freq`, `summary`, `evidence`, `example_post_ids`, …) round-trips in `metadata_json`. Edges `has_temporal_gap` link the topic root node to each gap. Idempotent — re-run upserts to the same `topic::temporal_gap::<slug>` node id, so a forced re-run replaces rather than duplicates.

**`_load_temporal_gaps_cache(topic)`** — reads all `kind='temporal_gap'` rows for the topic and rebuilds the original LLM output shape (`{painpoint, classification, pre_2025_freq, …}`) so callers don't need to know the rows live in `graph_nodes`. Returns `None` if no cache exists → caller runs the LLM.

**`clear_temporal_gaps(topic)`** — deletes the cached rows + their edges. Used by the "Re-run analysis" button to force a fresh run.

**`find_temporal_gaps(topic, …, force=False)`** — now:
1. If `force=False` and cache exists → return cache (fast path, skips 30–90 s LLM call).
2. Otherwise run the LLM as before.
3. On successful list result, call `_persist_temporal_gaps` so the next call hits cache. Error/parse-error results stay ephemeral so the caller can retry freely without having to clear manually.

### `src/reddit_research/research/__init__.py`

Exported `clear_temporal_gaps` in `__all__`.

### `src/reddit_research/cli/main.py`

`research temporal-gaps` command gained `--force` flag. When passed, the CLI calls `clear_temporal_gaps(topic)` before `find_temporal_gaps(..., force=True)` so the Python side re-runs the LLM and overwrites the stale rows.

### `app-tauri/src-tauri/src/commands.rs`

`run_temporal_gaps` command now takes an optional `force: bool` param and forwards `--force` to the CLI when true.

### `app-tauri/src/api.js`

`runTemporalGaps(topic, force = false)` — frontend binding for the new param.

### `app-tauri/src/screens/trends.js`

`runAndRender(contentEl, topic, force = false)` plumbs the flag through. Both the Re-run button (`#btn-rerun-trends`) and the empty-state "Run" button (`#btn-run-trends`) now call it with `force: true` — clicking Re-run now actually re-runs the LLM instead of just re-reading the same cached rows.

## Verification

- `.venv/python` round-trip test: persist 2 fake items → read → labels + metadata intact → clear → `None` returned. ✅
- Python pytest: 42 passed / 2 pre-existing failures (discover_subs shape + mcp extra not installed, unrelated to this change).
- `node --check` trends.js → clean.
- `cargo check` → clean, 4.25 s.

## UX delta

Before:
- First visit to Trends tab → 30–90 s LLM wait → see results.
- Second visit to Trends tab → **another 30–90 s LLM wait** for the same data.
- App restart → lose in-memory cache → another LLM wait.

After:
- First visit → 30–90 s LLM wait → results painted + persisted to graph_nodes.
- Second visit (same session or after app restart) → **~100 ms DB query** → cached results painted instantly.
- Re-run button clears the cache and triggers a fresh LLM pass on demand.

Same pattern all six "heavy LLM" feature do now: run once, cache forever, explicit re-run to invalidate. Users stop paying for the same query twice.

## Files Modified

- `src/reddit_research/research/gaps.py` — added `_persist_temporal_gaps`, `_load_temporal_gaps_cache`, `clear_temporal_gaps`; added `force` param to `find_temporal_gaps`
- `src/reddit_research/research/__init__.py` — export `clear_temporal_gaps`
- `src/reddit_research/cli/main.py` — `--force` flag on `research temporal-gaps`
- `app-tauri/src-tauri/src/commands.rs` — `force` param on `run_temporal_gaps`
- `app-tauri/src/api.js` — `runTemporalGaps(topic, force)` binding
- `app-tauri/src/screens/trends.js` — thread force through `runAndRender` and both button handlers
