# Find / Semantic search: no more stuck "Searching…"

**Date:** 2026-06-04
**Type:** Fix

## Summary

The Workspace → Find (semantic search) page got stuck on "Searching…" with
skeletons that never resolved. Root cause: `research semantic-search` called
`palace.search_posts()` with no timeout. The ChromaDB palace isn't safe for
concurrent cross-process access — while a collect runs, the `enrich-worker
--serve` process holds the store and the search read blocks indefinitely, so
the CLI never returned and the UI hung forever.

## Changes

- **`src/openreply/cli/main.py` (`cmd_research_semantic_search`):** bound the
  palace read with a wall-clock ceiling (daemon thread + `join`, same pattern as
  chat's `_call_with_timeout`). On timeout → graceful
  `{ok:false, busy:true, reason, results:[]}`. Default 25s
  (`OPENREPLY_PALACE_SEARCH_TIMEOUT`) — clears a cold ONNX one-shot reload (~12-15s)
  yet still bounds a genuinely stuck read. Exceptions → `{ok:false, error}`.
- **`app-tauri/src/screens/find.js` (`runSearch`):** added a 30s client-side
  safety-net timeout (Promise.race) so the page never hangs even if the backend
  stalls, and surfaced backend `busy`/`error` payloads as a clear message
  instead of a silent empty state.

## Verification

- Forced timeout (`OPENREPLY_PALACE_SEARCH_TIMEOUT=0.001`) → returns `busy`
  immediately (no hang).
- Default 25s → `ok:true` with results even on a cold one-shot during an active
  enrich-worker.

## Files Modified

- `src/openreply/cli/main.py`, `app-tauri/src/screens/find.js`

## Files Created

- `changelogs/2026-06-04_02_find-semantic-search-no-hang.md`
