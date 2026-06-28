# Research Mode — Phase 1 UI (Paper Reader)

**Date:** 2026-06-07
**Type:** Feature

## Summary

The Paper Reader screen (`#/reader/<post_id>`): read a paper's full text by
section, highlight passages (select → colour), take per-highlight notes, set
reading status (to_read/reading/read), and ask the paper questions with cited
answers — all backed by the Phase 1 reading backend + paperAsk.

## Changes

- **Backend**: `paper_reading.read_view(post_id)` composite payload (title,
  sections of full text, status, highlights) + CLI `research paper-read`, Tauri
  `paper_read`, api `paperRead`. Verified via CLI (8 sections returned for a
  real paper).
- **`screens/reader.js`**: section nav + body with re-marked saved highlights,
  selection→highlight colour bar, highlights/notes sidebar (edit + delete),
  reading-status pills, and an "Ask this paper" cited-QA panel scoped to the
  paper.
- **Router**: `#/reader/<post_id>` route + import in main.js.
- **Papers tab**: each paper row now has a "Read & annotate" link into the Reader.

## Verification

- `node --check` clean on reader.js / main.js / papers.js / api.js.
- `cargo check` clean.
- `paper-read` CLI returns the full composite payload end-to-end.

## Files Created
- `app-tauri/src/screens/reader.js`
- `changelogs/2026-06-07_06_research-mode-phase1-reader-ui.md`

## Files Modified
- `src/openreply/research/paper_reading.py` (read_view), `src/openreply/cli/main.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/api.js`, `app-tauri/src/main.js`, `app-tauri/src/screens/papers.js`
