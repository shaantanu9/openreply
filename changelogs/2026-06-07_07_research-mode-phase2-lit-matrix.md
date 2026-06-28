# Research Mode — Phase 2 (Literature-review matrix)

**Date:** 2026-06-07
**Type:** Feature

## Summary

The classic PhD lit-review grid. For each academic paper in a topic, an LLM
extracts a structured row — method · dataset · sample · findings · limitations ·
metric — from the paper's full text (falls back to abstract). Rows cache per
(topic, post_id); the UI renders a sortable/filterable table with CSV export and
links each paper into the Reader.

## Changes

- **`research/lit_matrix.py`** — `lit_matrix` table + `build`/`build_row`/`get`/
  `export_csv`. Reuses the BYOK provider + full-text-or-abstract content tier +
  defensive JSON parsing. Idempotent per (topic, post_id).
- **CLI**: `research lit-matrix --topic … [--build] [--limit] [--csv]`.
- **MCP**: `openreply_lit_matrix(topic, build, limit, force)`.
- **Tauri**: `lit_matrix_get` / `lit_matrix_build` / `lit_matrix_export`.
- **api.js**: `litMatrixGet` / `litMatrixBuild` / `litMatrixExport`.
- **`screens/lit_matrix.js`** + route `#/lit-matrix/<topic>`: filter, click-to-sort
  columns, Build/refresh, Export CSV (to clipboard), paper→Reader links.

## Verification

- Built real rows for the binaural-beats corpus (e.g. method "Randomized EEG
  study with 33 students", findings "Increase in Alpha, decrease in Beta").
- Python imports + MCP tool registered; CLI read path returns rows;
  `node --check` + `cargo check` clean.

## Files Created
- `src/openreply/research/lit_matrix.py`, `app-tauri/src/screens/lit_matrix.js`,
  `changelogs/2026-06-07_07_research-mode-phase2-lit-matrix.md`

## Files Modified
- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/api.js`, `app-tauri/src/main.js`
