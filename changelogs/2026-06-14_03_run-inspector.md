# 2G — Run Inspector (forensic "session replay")

**Date:** 2026-06-14
**Type:** Feature
**Part of:** WhyBuddy port, Wave 2. Consumes 1A's run-scoped `checks_ledger` + `lineage`.

## Summary

Adds a read-only **run inspector** — the safe adaptation of WhyBuddy's "session
replay." It does not re-execute anything; it surfaces what each pipeline run
(grouped by the `run_id` 1A stamps) recorded: its quality-gate checks and the
lineage (artifacts → source posts) it produced. Distinct from `iterate.py`'s
config-tuning `iterate_runs`.

## Changes (committed)
- `src/openreply/research/replay.py` — `list_runs(topic=None, limit=50)` (aggregate
  `checks_ledger` by run_id, exclude empty, counts + last_ts) and `get_run(run_id)`
  (`{checks, lineage}`). Both best-effort, never raise.
- **CLI**: `research runs [--topic]` + `research run-get --run-id`.
- **MCP**: `openreply_runs_list(topic="")` + `openreply_run_get(run_id)`.
- **UI**: a "Recent runs" table in the existing Provenance & Audit panel
  (`provenance.js`) via `api.runQuery` — run_id, topic, passed/total checks, last_ts.

## Files Created
- `src/openreply/research/replay.py`, `tests/test_replay.py`, `tests/test_replay_mcp.py`

## Files Modified
- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`, `app-tauri/src/screens/provenance.js`
