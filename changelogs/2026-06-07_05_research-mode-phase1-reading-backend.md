# Research Mode — Phase 1 backend (reading status + highlights/notes)

**Date:** 2026-06-07
**Type:** Feature

## Summary

Backend for the per-paper reading loop: reading status (to_read|reading|read),
a to-read queue, and highlights + notes. New module `paper_reading.py` + two
additive tables, exposed across CLI / MCP / Tauri / api.js. Verified end-to-end
(in-process + cross-process persistence + the exact CLI path the Tauri layer
invokes). cargo check clean.

## Changes

- **`research/paper_reading.py`** — tables `paper_reading_status`,
  `paper_highlights` (CREATE IF NOT EXISTS, raw SQL writes + explicit commit to
  match the codebase convention). Functions: `set_status`/`get_status`/
  `list_status`/`reading_queue`/`status_counts`; `add_highlight`/
  `list_highlights`/`update_highlight`/`delete_highlight`/`topic_notes`.
- **CLI**: `research paper-reading-status`, `research reading-queue`,
  `research paper-highlight {add|list|update|delete}`, `research paper-notes`.
- **MCP**: `openreply_paper_reading_status`, `openreply_paper_reading_queue`,
  `openreply_paper_highlight`, `openreply_paper_notes`.
- **Tauri**: `paper_reading_status`, `paper_reading_queue`, `paper_highlight`,
  `paper_notes` (registered in main.rs).
- **api.js**: `paperReadingStatus`, `paperReadingQueue`, `paperHighlight`,
  `paperNotes`.

## Bug fixed during build

sqlite-utils `Table.upsert()` (singular) didn't persist on the thread-local
cached connection; switched to raw `INSERT … ON CONFLICT` + `db.conn.commit()`
(the proven pattern — `upsert_all` self-commits, raw execute needs explicit
commit, per db.py:774/999).

## Files Created
- `src/openreply/research/paper_reading.py`
- `changelogs/2026-06-07_05_research-mode-phase1-reading-backend.md`

## Files Modified
- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/api.js`
