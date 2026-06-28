# Research Mode — reading-status dots in the Papers list

**Date:** 2026-06-07
**Type:** Feature

## Summary

The Papers list now shows reading progress at a glance: a small coloured dot
(blue = reading, green = read; to_read = none) is prepended to each paper's
title. Read-only post-render DOM annotation sourced from one status fetch — no
table re-render, no interactive mutation.

## Changes

- **CLI**: `research reading-list --topic [--status]` (wraps
  `paper_reading.list_status`). **Tauri**: `paper_reading_list`. **api.js**:
  `paperReadingList`.
- **Papers tab** (`papers.js`): `annotateReadingStatus()` fetches the topic's
  statuses once and prepends a dot to each read/reading paper's title cell;
  called from both the cached and fresh render paths.

## Verification

- CLI `reading-list` returns items; `node --check` (papers.js, api.js) +
  `cargo check` clean.

## Files Created
- `changelogs/2026-06-07_13_research-mode-papers-reading-dots.md`

## Files Modified
- `src/openreply/cli/main.py`, `app-tauri/src-tauri/src/commands.rs`,
  `app-tauri/src-tauri/src/main.rs`, `app-tauri/src/api.js`,
  `app-tauri/src/screens/papers.js`
