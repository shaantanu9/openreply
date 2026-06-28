# Incremental persistence + topic cache refresh hardening

**Date:** 2026-04-22  
**Type:** Reliability + performance + state-consistency

## Summary

This pass ensures the app behaves as an incremental, DB-first system end-to-end:

- fetched/extracted data keeps persisting incrementally into SQLite,
- topic/page reopen paths reuse saved state instead of rebuilding everything,
- UI cache invalidation is now scoped by mutation kind + topic to avoid
  unnecessary full-tab refreshes while still staying correct.

This directly addresses:  
"whatever data we extract we should keep saving in db and reuse properly next
time when topic/page opens."

## What was already true (confirmed)

The backend pipeline already persisted incrementally and idempotently:

- `posts` upsert path in `src/reddit_research/core/db.py` (`upsert_posts`)
- `topic_posts` idempotent tagging in `src/reddit_research/research/collect.py`
  (`pk=(topic, post_id), ignore=True`)
- `extraction_queue` idempotent enqueue for incremental enrichment
  (`pk=(topic, post_id, kind), ignore=True`)

So DB persistence was not the weak link; the larger issue was broad UI
invalidations causing avoidable cold refreshes.

## Changes made now

### 1) Topic-level mutation handling is now incremental

**File:** `app-tauri/src/screens/topic.js`

Updated `onOpenreplyChangedTask8`:

- now reads mutation metadata (`detail.kind`, `detail.topic`)
- ignores mutation events for other topics
- maps mutation kinds to only the affected tabs instead of invalidating all tabs
- refreshes currently active tab only when that tab is in the dirty set
- preserves map loop guard (map tab still avoids self-triggered reactive reload)

Kind-scoped invalidation map added for:

- `collect`
- `ingest`
- `findings`
- `graph`
- `byok`
- `schedule`
- `topics`
- `trash`
- `extraction_prefs`
- fallback `db` bucket

### 2) External DB writes now follow same refresh path

**File:** `app-tauri/src/screens/topic.js`

Added `openreply:db-changed` listener routing into the same incremental invalidation
logic. This keeps topic views correct when data changes outside the screen flow
(e.g., CLI/MCP/background writes) while preserving unaffected tab caches.

### 3) Better operator guidance on empty enrich result

**File:** `app-tauri/src/screens/topic.js`

Updated map banner text for 0-painpoint outcomes:

- from generic rerun collect guidance
- to explicit incremental action: rerun collect with **Only new sources** then rerun enrich

This aligns user flow with incremental persistence and avoids redundant rework.

## Why this matters

Previously, broad invalidation made many tab surfaces cold-load after each
mutation, even when underlying data for some tabs had not changed. That reduced
the practical value of incremental persistence at the UX layer.

Now:

- DB remains source-of-truth and continuously updated incrementally,
- UI reuses warm state when safe,
- only affected surfaces refresh,
- reopened topics/pages feel faster and remain correct.

## Validation

- Lint check for modified topic screen passed:
  - `ReadLints` reported no diagnostics for `app-tauri/src/screens/topic.js`.
- Diff review confirmed mutation-kind/topic-scoped invalidation and external DB
  change wiring were applied.

## Files Modified (this pass)

- `app-tauri/src/screens/topic.js`

## Related changelogs

- `changelogs/2026-04-22_04_graph-quality-hardening-and-repair-runbook.md`
- `changelogs/2026-04-22_map-tab-hang-memory-leak-fix.md`
- `changelogs/2026-04-22_03_graph-escape-fix.md`
