# Graph Structural Invariant Guard (2B)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Adds a non-fatal structural invariant guard for topic knowledge graphs. After every `_build_structural_body` run, four checks are evaluated (required_fields, root_present, acyclic, no_orphans) and each result is written to `checks_ledger` via `record_check`. Results are surfaced through a new CLI command and MCP tool so the Provenance & Audit panel can display them without any additional wiring.

## Changes

- New `check_graph_invariants(topic)` function — runs 4 invariant checks, records each to checks_ledger, never raises
- Wired into `_build_structural_body` in `build.py` after the existing `build_complete` ledger write (best-effort try/except)
- CLI command `research graph-invariants --topic <t>` added to `research_app`
- MCP tool `gapmap_graph_invariants(topic)` added to server.py, registered in `_TOOL_REGISTRY`
- 7 passing tests across 3 test files (invariants unit, build wiring, MCP surface)

## Files Created

- `src/gapmap/graph/invariants.py`
- `tests/test_graph_invariants.py`
- `tests/test_build_runs_invariants.py`
- `tests/test_graph_invariants_mcp.py`
- `changelogs/2026-06-14_03_graph-invariant-guard.md`

## Files Modified

- `src/gapmap/graph/build.py` — added invariant guard call after build_complete record_check
- `src/gapmap/cli/main.py` — added `graph-invariants` command to research_app
- `src/gapmap/mcp/server.py` — added `gapmap_graph_invariants` tool before `gapmap_diagnostics`
