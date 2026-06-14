# Sub-project 2G — Run Inspector ("session replay", adapted)

**Date:** 2026-06-14 · **Roadmap:** WhyBuddy port, Wave 2. Consumes 1A's run-scoped `checks_ledger` + `lineage`.

## Goal
WhyBuddy's "session replay" = re-examine what a run did. True re-execution is risky for Gap Map; the honest, high-value adaptation is a **forensic run inspector**: list pipeline runs (grouped by the `run_id` 1A stamps) and show, for any run, the quality-gate checks it recorded and the lineage (artifacts → source posts) it produced. Read-only; nothing re-executes.

Distinct from `research/iterate.py`'s `iterate_runs` (a config-tuning loop table) — this inspects the provenance run_id on `checks_ledger`/`lineage`.

## Components
1. `src/gapmap/research/replay.py`:
   - `list_runs(topic=None, limit=50) -> list[dict]` — aggregate `checks_ledger` by `run_id` (skip empty `run_id`), each `{run_id, topic, n_checks, n_passed, last_ts}`; optional topic filter; ordered by last_ts desc. Best-effort `[]`.
   - `get_run(run_id) -> dict` — `{run_id, checks:[...from checks_ledger...], lineage:[...from lineage WHERE produced_by=run_id...]}`. Best-effort.
   - Never raises.
2. **CLI**: `research runs [--topic] [--json]` and `research run-get --run-id [--json]`.
3. **MCP**: `gapmap_runs_list(topic="")`, `gapmap_run_get(run_id)`.
4. **UI**: add a read-only "Recent runs" table to the existing Provenance & Audit panel (`app-tauri/src/screens/provenance.js`) — run_id (short), topic, checks passed/total, last_ts — via `api.runQuery` (grouped SQL; no new Rust needed). Clicking a run could filter the checks table (nice-to-have; minimal version just lists runs).

## Testing
- `list_runs`: seed 2 runs of checks → returns 2 grouped rows with correct counts; empty run_id excluded.
- `get_run`: seed checks + lineage for a run_id → returns both arrays.
- bad DB → `[]`/`{}` (never raises).
- MCP roundtrip.

## Non-fatal / compat
Pure read over existing tables; no schema change; never raises. UI uses `api.runQuery` (read path).
