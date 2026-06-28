# Find: keyword fallback + reader-priority so search always returns results

**Date:** 2026-06-04
**Type:** Fix | Enhancement

## Summary

Building on the no-hang timeout fix: during an active collect on the same topic,
the semantic palace stays locked, so search would time out → "busy". Now Find
always returns useful results.

## Changes (`src/openreply/cli/main.py`)

- **Reader priority:** `cmd_research_semantic_search` now raises the
  `mark_chat_active()` coordination flag (heartbeat thread, refreshed every 4s)
  so the enrich-worker yields its palace writes while the search reads — the
  same mechanism chat uses.
- **Keyword fallback (`_semantic_keyword_fallback`):** when the palace read
  times out, errors, or returns nothing, fall back to a fast SQLite keyword
  search over `posts` (topic/source scoped, ranked by matched-word count +
  engagement), returned in the exact `search_posts` shape so the UI renders it
  identically. Response carries `fallback:"keyword"` + a `note`.

## Changes (`app-tauri/src/screens/find.js`)

- Show the `note` ("Semantic index was busy — showing keyword matches.") above
  results so the degrade is transparent.

## Verification

- Topic-scoped search during an active collect on that topic → `ok:true`,
  `fallback:"keyword"`, 5 results (previously `busy`/stuck).

## Files Modified

- `src/openreply/cli/main.py`, `app-tauri/src/screens/find.js`

## Files Created

- `changelogs/2026-06-04_03_find-keyword-fallback.md`
