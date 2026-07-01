# Competitor Intelligence Feature

**Date:** 2026-07-01
**Type:** Feature

## Summary

Adds a full seed-driven competitor research and tracking system. Users register competitor names against a product, optionally enrich them via LLM to surface suggested aliases and subreddits, then run sweeps that collect posts, find gaps, score sentiment, fire 6 signal detectors, and persist snapshots with deltas. Results surface in a new 3-tab Tauri *Competitors* screen (Opportunities / Complaints / Comparison) and via 10 new MCP tools and a `openreply competitor` CLI group. Detected "competitor moves" are also fed into the Daily Update digest pipeline.

## Changes

- Backend package `src/openreply/research/competitor_intel/` created with 6 modules:
  - `registry.py` — CRUD over `product_competitors` (add/get/list/update/remove)
  - `enrich.py` — LLM seed enricher (`enrich_seed`): suggested aliases, subreddits, website, category
  - `sweep.py` — `run_competitor_sweep`: collect → gap-find → sentiment → signal generation → snapshot/delta; `latest_snapshot` accessor
  - `signals.py` — write/list/query over `product_signals` (findings, opportunities, set_signal_action)
  - `compare.py` — `build_comparison`: head-to-head metrics + sentiment
  - `digest_hook.py` — `competitor_moves`: extracts recent signals for Daily Update digest
- New `src/openreply/analyze/sentiment.py` — LLM sentiment classification by source (`sentiment_by_source`, `classify_batch`)
- Schema migration in `src/openreply/core/db.py:init_schema`:
  - Extended `product_competitors` with 10 new columns (slug, topic, aliases_json, subreddits_json, source_config_json, status, daily_fetch, in_opp_scan, notes, updated_at)
  - New `competitor_snapshots` table (id, product_id, competitor_name, sweep_id, created_at, metrics_json, summary, delta_json)
- CLI group `openreply competitor` in `src/openreply/cli/competitor_cmds.py` (11 commands: add/list/show/enrich/run/findings/opps/compare/set-action/remove), registered in `cli/main.py`
- MCP sub-server `src/openreply/mcp/tools/competitor_tools.py` — 10 `openreply_competitor_*` tools; mounted in `mcp/server.py`
- Tauri Rust: 10 `#[tauri::command]` functions added to `app-tauri/src-tauri/src/commands.rs`; all registered in `main.rs` generate_handler
- Tauri JS: 11 `competitor*` API wrappers in `app-tauri/src/or/api.js`; `renderCompetitors` 3-tab screen + `buildCompetitorsCard` Settings card in `app-tauri/src/or/dynamic.js`; nav entry in `app-tauri/src/or/shell.js`
- Competitor moves wired into `src/openreply/reply/digest.py:build_digest` (imported from `digest_hook.competitor_moves`)

## Files Created

- `src/openreply/research/competitor_intel/__init__.py`
- `src/openreply/research/competitor_intel/registry.py`
- `src/openreply/research/competitor_intel/enrich.py`
- `src/openreply/research/competitor_intel/sweep.py`
- `src/openreply/research/competitor_intel/signals.py`
- `src/openreply/research/competitor_intel/compare.py`
- `src/openreply/research/competitor_intel/digest_hook.py`
- `src/openreply/analyze/sentiment.py`
- `src/openreply/cli/competitor_cmds.py`
- `src/openreply/mcp/tools/competitor_tools.py`

## Files Modified

- `src/openreply/core/db.py` — schema: extend `product_competitors` columns; create `competitor_snapshots` table
- `src/openreply/cli/main.py` — register `competitor_app` Typer group
- `src/openreply/mcp/server.py` — mount `competitor_server` sub-server
- `src/openreply/reply/digest.py` — import and call `competitor_moves` in `build_digest`
- `app-tauri/src-tauri/src/commands.rs` — 10 new Rust command functions (lines 4091–4172)
- `app-tauri/src-tauri/src/main.rs` — register all 10 competitor commands in `generate_handler`
- `app-tauri/src/or/api.js` — 11 `competitor*` JS wrappers (lines 423–434)
- `app-tauri/src/or/dynamic.js` — `renderCompetitors` (3-tab screen, line 5586) + `buildCompetitorsCard` Settings card (line 1628)
- `app-tauri/src/or/shell.js` — `competitors` nav entry (line 18)
