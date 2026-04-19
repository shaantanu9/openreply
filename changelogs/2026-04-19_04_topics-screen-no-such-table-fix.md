# Fix: Topics screen crashes before first collect (no such table: topic_posts)

**Date:** 2026-04-19
**Type:** Fix

## Summary

The Topics screen rendered a bare `OperationalError: no such table: topic_posts`
whenever the user opened the app before running their first collect. Root
cause: `topic_posts` and the two `graph_*` tables were created lazily (inside
`research.collect` and `graph.build` respectively), but read-only queries like
`list_topics` / `overview_stats` / the topic header-stats count joined those
tables at app startup.

A prior revision of `core/db.py` had attempted to pre-create the graph tables
but used the wrong column names (`meta_json` / `created_at`) — diverging from
the canonical schema in `graph/schema.py` (`metadata_json`). Inserts from
`research graph build` would then silently fail against the stale columns.

## Changes

- `core/db.py::init_schema` now creates `topic_posts`, `graph_nodes`,
  `graph_edges` up-front with the same columns/indexes as
  `research.collect._ensure_topics_table` and `graph.schema.ensure_graph_schema`.
- Added a one-shot migration that renames `meta_json` → `metadata_json` on
  `graph_nodes` / `graph_edges` if the old column is detected, so existing
  SQLite files don't need to be deleted.
- `app-tauri/src/screens/home.js::renderTopicsList` now treats a
  "no such table" error as an empty workspace (shows a clean "No topics yet"
  CTA instead of dumping the raw traceback), distinguishes filter-empty from
  truly-empty, and exposes a retry button for real errors.

## Files Modified

- `src/reddit_research/core/db.py` — `init_schema` now creates topic_posts /
  graph_nodes / graph_edges; added `meta_json → metadata_json` rename migration
  and aligned schema with `graph/schema.py`.
- `app-tauri/src/screens/home.js` — `renderTopicsList` error + empty-state UX.

## Follow-up

- Rebuild the Python sidecar so the Tauri app picks up the new
  `init_schema`:
  ```bash
  cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
  bash scripts/build-pyinstaller.sh
  cp dist/reddit-cli-aarch64-apple-darwin app-tauri/src-tauri/binaries/
  ```
