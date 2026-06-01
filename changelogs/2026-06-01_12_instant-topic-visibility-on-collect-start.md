# Topic appears in the listing instantly when a collect starts

**Date:** 2026-06-01
**Type:** Fix

## Summary

When a user started collecting a new topic, it didn't show up in the topic listing for 30-60+ seconds — only after the LLM canonicalization finished and the first posts were tagged into `topic_posts`. Two root causes:

1. **The `topic_prefs` insert never actually ran.** `collect.py` called `_now_iso()` in all three `topic_prefs` inserts, but the helper is named **`_ts_iso()`** — so every call raised `NameError`, which was swallowed by the surrounding `try/except: pass`. The row that would make a topic visible via `list_topics` (`SELECT topic FROM topic_posts UNION SELECT topic FROM topic_prefs`) was silently never written. Topics only appeared once `topic_posts` had rows.
2. **The one (broken) insert was deferred until after canonicalization** (the ~30-60s cold-model LLM call), to avoid a phantom-duplicate row.

## Fix

- **Corrected the name:** `_now_iso(` → `_ts_iso(` (3 occurrences). The `topic_prefs` insert now actually executes.
- **Restored instant visibility (phantom-safe):** insert the `topic_prefs` row *before* canonicalization (under the typed/alias-resolved name) so the topic shows in `list_topics` within ~0.5s of the collect starting. If canonicalization then rewrites the name, **migrate** the row to the canonical and drop the typed-form row **only when it has no tagged posts** — eliminating the phantom-duplicate that caused the insert to be deferred originally.
- **Frontend follow-up refresh:** `startCollect` fired `mutated('collect')` synchronously, a beat before the Python early-insert lands. Added two delayed `mutated('topics')` refreshes (1.2s + 3.5s) so the listing reliably re-fetches once the row exists.

Net: new-topic visibility latency drops from **30-60s → ~1s**.

## Verification

- `_now_iso` occurrences: 0; `_ts_iso(` calls: 4. `collect.py` + `api.js` parse clean.
- Functional test: inserting a `topic_prefs` row with `_ts_iso()` makes the topic appear in the `list_topics` UNION query immediately (test row cleaned up after).

## Files Modified

- `src/gapmap/research/collect.py` — `_now_iso`→`_ts_iso`; early `topic_prefs` insert + canonical migration (drop empty typed row).
- `app-tauri/src/api.js` — `startCollect` delayed follow-up `mutated('topics')` refreshes.
