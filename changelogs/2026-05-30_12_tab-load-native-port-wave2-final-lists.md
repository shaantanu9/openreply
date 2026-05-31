# Tab-load latency — Wave 2 (final): native ports for survey / pert / ost / experiments / paper-analyses

**Date:** 2026-05-30
**Type:** Fix (performance)

## Summary

Completes the Wave 2 native rusqlite migration of read-only SELECT-shaped
commands (changelogs `10`, `11`). Ports the last 5 list/get reads in place
(same command names → no api/registration churn; Wave-1 SWR persistence keeps
working). Each verified against the Python `--json` golden output.

**Ported (5 commands):**

- `paper_analyses_get` — was already a plain parameterized `query` over the
  sidecar; now the identical SELECT via native `query_db`, returning the bare
  rows array.
- `list_experiments` — mirrors `gap_discovery.list_experiments`: `SELECT *
  FROM experiments WHERE topic=:t ORDER BY created_at DESC`, hydrate
  `citations_json` → `citations` (pop, default []) and `design_json` →
  `design` (pop, default {}); envelope `{"topic": …, "experiments": [...]}`.
- `ost_experiments_list` — mirrors `ost.list_experiments` (painpoint_id →
  `WHERE topic AND painpoint_id`, else `WHERE topic`; `ORDER BY created_at
  DESC`; no hydration); envelope `{"experiments": [...]}`.
- `survey_list` — mirrors `pricing.list_responses` (topic/product_id/kind each
  an independent AND filter; `ORDER BY responded_at DESC LIMIT 500`; per-row
  `data_json` → `data` with Python `or {}` falsy semantics; raw `data_json`
  column kept); envelope `{"responses": [...]}`.
- `pert_list` — mirrors `pert.list_tasks` (product_id [+ tier]; `ORDER BY
  created_at` ASC) + `_decorate`: `expected = round((o+4m+p)/6, 2)`,
  `stddev = round(max(0,(p-o)/6), 2)` using Python banker's rounding
  (`round_ties_even`); envelope `{"tasks": [...]}`.

## Still on the sidecar (by design)

- `pmf_score`, `interview_summary` — these compute aggregations (counts,
  averages, PMF %), not plain SELECTs. Kept on the sidecar; already instant on
  revisit via Wave-1 persistence. Port only if the marginal first-load win is
  worth replicating the math (recommend not).

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — 5 commands ported; added
  `hydrate_experiment_row`, `is_py_falsy`, `round2`, `pert_decorate_row`.

## Verification

- `cargo check` → clean (`round_ties_even` available; only the pre-existing
  JWT debug-fallback warning).
- `pert_list`: `_decorate` byte-exact on live data — o=5/m=8/p=14 → expected
  8.5, stddev 1.5; o=3/m=6/p=12 → 6.5 / 1.5.
- `paper_analyses_get`: native row count + column keys match the Python
  `query` output for a live topic.
- Empty/no-table envelopes match Python exactly: `survey-list` →
  `{"responses":[]}`, `ost-experiments-list` → `{"experiments":[]}`,
  `experiments-list` (no table) → `{"topic":…,"experiments":[]}`.

## Wave 2 total

16 read-only commands now native (~2s/call → ~10ms): empathy (2), product
strategy (6), interviews (2), pmf_list, survey_list, pert_list,
ost_experiments_list, list_experiments, paper_analyses_get. Ships via a Tauri
app rebuild (cargo) — these reads no longer touch the Python sidecar.
