# Research Mode — Phase 4 (Library + collections)

**Date:** 2026-06-07
**Type:** Feature

## Summary

The cross-project paper Library (`#/library`): browse every academic paper in
the corpus regardless of which topic gathered it, filter by collection / reading
status / title, organise papers into named collections, and jump into the
Reader. New `paper_library.py` + two additive tables (`paper_collections`,
`paper_collection_items`), exposed across CLI / MCP / Tauri / api.js, with a
research-mode sidebar entry.

## Changes

- **`research/paper_library.py`** — collections CRUD + membership + a unified
  `library()` view joining reading status + collection membership across topics.
- **CLI**: `research library`, `research collections {list|create|rename|delete|add|remove}`.
- **MCP**: `gapmap_paper_library`, `gapmap_paper_collections`.
- **Tauri**: `paper_library`, `paper_collections` (registered).
- **api.js**: `paperLibrary`, `paperCollections`.
- **`screens/library.js`** + route `#/library`: collections sidebar (create/
  delete), status filters, title search, paper rows (status dot, source,
  add-to-collection, Reader link). Research-mode nav entry in index.html.

## Verification

- Backend tested end-to-end (create/list/add/remove/filter/delete).
- Python + MCP tools registered; CLI library/collections paths return data;
  `node --check` + `cargo check` clean.

## Files Created
- `src/gapmap/research/paper_library.py`, `app-tauri/src/screens/library.js`,
  `changelogs/2026-06-07_09_research-mode-phase4-library.md`

## Files Modified
- `src/gapmap/cli/main.py`, `src/gapmap/mcp/server.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/api.js`, `app-tauri/src/main.js`, `app-tauri/index.html`
