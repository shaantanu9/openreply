# Research Mode — flow-status progress (gather→read→synthesize→write)

**Date:** 2026-06-07
**Type:** Feature

## Summary

Per-project research-flow progress so a researcher always sees where each
project sits in the pipeline. New `flow_status.py` (pure read over existing
tables — no LLM/writes) computes papers, fulltext, chunked, analyzed,
lit-matrix, read/reading/to_read, has_draft, and normalized stage fractions.
Surfaced as a 4-segment progress bar on each Research Home project card.

## Changes

- **`research/flow_status.py`** — `flow_status(topic)`; defensive (`_table_exists`
  guards) so it works before any research tables are created.
- **CLI**: `research flow-status --topic`. **MCP**: `gapmap_flow_status`.
  **Tauri**: `flow_status`. **api.js**: `flowStatus`.
- **Research Home**: project cards get a lazily-filled Gather→Read→Synthesize→
  Write bar (sequential, bounded to 14 cards to avoid a sidecar flood).
- **Tests**: 2 new (`test_flow_status_*`) — 13/13 in `test_research_mode.py`.

## Verification

- Real corpus: gather 1.0, read 0.038, synthesize 0.077, write 0.0 (26 papers).
- 13 unit tests pass; `cargo check` + `node --check` clean.

## Files Created
- `src/gapmap/research/flow_status.py`, `changelogs/2026-06-07_12_research-mode-flow-status.md`

## Files Modified
- `src/gapmap/cli/main.py`, `src/gapmap/mcp/server.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/api.js`, `app-tauri/src/screens/research_home.js`,
  `tests/test_research_mode.py`
