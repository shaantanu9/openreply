# 1A — Provenance & Auditability Foundation (backend + graph tagging)

**Date:** 2026-06-13
**Type:** Feature
**Part of:** WhyBuddy port roadmap, Wave 1 (keystone). Spec: `docs/superpowers/specs/2026-06-13-1A-provenance-auditability-design.md`. Plan: `docs/superpowers/plans/2026-06-13-1A-provenance-auditability.md`.

## Summary

Shipped the data-model foundation that makes every generated Gap Map artifact
auditable, ported (and adapted SQLite-first) from WhyBuddy's provenance/ledger/
lineage patterns. Every write is additive and non-fatal — it never blocks
enrich/build. 9 tests pass.

## Changes (Tasks 1-6 of the plan — committed)

- **Schema** (`core/db.py`): new `provenance` column on `graph_nodes` (idempotent
  lazy migration); new `checks_ledger` table (quality-gate records) + `lineage`
  table (artifact → source posts / run), each with indices.
- **run_id contextvar** (`core/runctx.py`): `new_run_id`/`set_run_id`/`current_run_id`
  to group ledger + lineage rows per pipeline run.
- **Helpers** (`core/db.py`): `record_check(...)` and `record_lineage(...)` —
  best-effort, return `-1` on failure, never raise (mirror the fetch-audit pattern).
- **Provenance threading** (`graph/build.py::_upsert_node`): `provenance` param
  persisted through both the batch fast-path (7-col `_flush_batch`) and the legacy
  per-row path; existing tags preserved on re-run (never blanked).
- **LLM tagging + lineage** (`graph/semantic.py`): `upsert_semantic` tags nodes
  `llm` (or `llm_fallback` when `_fallback` is set) and emits a `record_lineage`
  row with the finding's `example_post_ids`.
- **Structural tagging** (`graph/build.py`): 9 structural node call-sites tagged
  `structural`; a `build_complete` check recorded at end of `_build_structural_body`.

## Files Created
- `src/gapmap/core/runctx.py`
- `tests/test_provenance_schema.py`, `test_runctx.py`, `test_ledger_lineage.py`,
  `test_node_provenance.py`, `test_semantic_provenance.py`, `test_build_provenance.py`

## Files Modified
- `src/gapmap/core/db.py` (schema + helpers)
- `src/gapmap/graph/build.py` (`_upsert_node` provenance + structural tags + build check)
- `src/gapmap/graph/semantic.py` (llm tags + lineage emission)

## Deferred (remaining 1A tasks)
- **Task 7** — record `json_parse`/`llm_call` checks inside `research/enrich_worker.py`
  (clean file; not yet done — the data model is ready, just needs the call-sites).
- **Task 8** — MCP tools `gapmap_checks_list`/`gapmap_lineage_get`: **blocked** because
  `mcp/server.py` has uncommitted WIP. The data is already queryable via the existing
  `gapmap_query_db` tool in the meantime.
- **Task 9** — provenance badge on insight cards + read-only Provenance & Audit panel:
  the badge (`insights.js`) + new `provenance.js` are clean to add, but the `#/provenance`
  route lives in `main.js` which has uncommitted WIP — route wiring deferred.
