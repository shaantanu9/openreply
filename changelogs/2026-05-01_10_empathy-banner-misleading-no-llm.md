# Empathy Map — fix misleading "No LLM configured" banner on never-built maps

**Date:** 2026-05-01
**Type:** Fix

## Summary

The Empathy Maps page showed a yellow "⚠ No LLM configured — showing
offline seed from your local corpus" banner on every freshly-loaded
topic, even when the user had a working LLM. Three stacked bugs:

1. **Frontend `offlineSeed` flag conflated "never built" with "built
   offline"** — `offlineSeed = !exists || ...` fired the warning when
   the row simply didn't exist yet, so any unvisited topic looked like
   the LLM had failed.
2. **Backend didn't persist the offline-vs-LLM state** —
   `get_empathy_map` returned no signal about how the row was built,
   so reads couldn't surface accurate provenance.
3. **`isMissingMapError` matched any error containing "empathy map"** —
   too broad; legitimate parse / DB errors were misrouted into the
   auto-bootstrap path that triggered the false banner.

## Changes

### Backend
- `research/empathy.py::build_empathy_map` now writes
  `built_offline: 0|1` on every upsert (sqlite-utils auto-adds the
  column). The flag is the inverse of `used_llm`.
- `research/empathy.py::get_empathy_map` returns
  `built_offline: bool` so the UI can paint accurate provenance on
  every read. Old rows without the column return falsy → no banner
  (better default than a misleading warning on legacy data).

### Frontend (`screens/empathy.js`)
- `renderEmpathyShell` now takes a `state` enum
  (`never_built | offline | llm | empty_corpus`) instead of a
  boolean `offlineSeed`. Each state gets its own banner copy:
    - **never_built** — friendly "Click Build / refresh to mine the corpus" (not a warning)
    - **offline** — real warning, only shown when the persisted row reports `built_offline: true`
    - **empty_corpus** — explains that no posts matched the persona
    - **llm** — no banner
- `isMissingMapError` tightened to match only "not found" (the literal
  backend missing-row response), not any error mentioning the screen
  name.

## Files Modified

- `src/reddit_research/research/empathy.py` — persist + return `built_offline`
- `app-tauri/src/screens/empathy.js` — state-based banner + tighter error matcher
- `changelogs/2026-05-01_10_empathy-banner-misleading-no-llm.md`
