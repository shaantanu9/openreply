# Feature 7 — GummySearch import + discovery presets

**Date:** 2026-06-07
**Type:** Feature

## Summary

The migration wedge. GummySearch shuts down Nov 30 2026 (no Reddit commercial licence), stranding paying users who curated subreddit "audiences". OpenReply can now import a GummySearch export (JSON or CSV, tolerant of shape) into a new `audiences` table, and seed fresh users with 8 curated preset bundles for instant first-run. Verified: JSON-list, flat-list, and CSV imports all parse; presets list + add work end-to-end.

## Changes

- New core module `sources/gummysearch_import.py`: `import_file()` (tolerant JSON/CSV parser, strips `r/` prefixes, dedupes), `list_audiences()`, `presets()`, `import_preset()`, and 8 `PRESET_BUNDLES` (saas, ai_tools, fitness, personal_finance, productivity, mental_health, ecommerce, developers). Auto-creates `audiences`.
- CLI: `openreply research import-gummysearch --path …` and `openreply research audiences [--presets] [--add-preset KEY]`.
- MCP: `openreply_import_gummysearch(path)` and `openreply_audiences(action, preset)` tools.
- Tauri: 4 commands (`import_gummysearch`, `audiences_list`, `audience_presets`, `audience_add_preset`) registered; JS wrappers in `api.js`; new `audiences.js` screen routed at `#/audiences` ("Switch from GummySearch" import + preset chips + saved-audience list).
- Tests: `tests/test_gummysearch_import.py` — 5 tests (JSON audiences, flat list, CSV, presets/add, missing file). All pass. `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/sources/gummysearch_import.py`
- `app-tauri/src/screens/audiences.js`
- `tests/test_gummysearch_import.py`

## Files Modified

- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/main.js`
