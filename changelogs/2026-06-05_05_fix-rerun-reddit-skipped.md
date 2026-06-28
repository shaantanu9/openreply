# Fix: rerun/refetch silently skipped Reddit + explicit Reddit prompt

**Date:** 2026-06-05
**Type:** Fix

## Summary

On rerunning a topic collect, Reddit was sometimes not fetched. Root cause:
the source-picker's `_persistPickerSelection()` was called by BOTH "Run" and
"Save (don't fetch yet)", and it always wrote the **one-shot handoff keys**
(`openreply.collect.last_skip_reddit` / `last_sources` / `last_aggressive`) that
the very next `collect.js` mount reads-then-deletes. So a saved sources-only /
Reddit-unchecked selection leaked into the NEXT collect fired by any trigger —
"Fetch more", a fresh collect, even a *different topic* — silently skipping
Reddit. "Fetch more" compounded it by never clearing those keys.

## Fixes (`app-tauri/src/screens/topic.js`)

1. **`_persistPickerSelection(oneShot)`** — only writes the one-shot collect keys
   when `oneShot` is true. "Run" passes `true`; "Save (don't fetch yet)" passes
   `false` (writes only the durable per-topic preference). No more cross-collect
   pollution.
2. **"Fetch more"** now explicitly sets `last_skip_reddit='false'` +
   `last_sources=''` — a deep fetch always includes Reddit + every source and
   can never inherit a stale picker selection.
3. **Explicit Reddit prompt** — clicking "Run" with Reddit unchecked now asks
   "Run without Reddit?" via `confirmModal`, so a no-Reddit collect is always a
   confirmed choice, never an accident.
4. **New RSS sources in the picker** — added `rss_listings` (Software listings /
   G2) and `rss_user` (My custom feeds) to `ALL_SOURCES` (defaultOn) so they're
   selectable on rerun.

## Verification

Node simulation of the picker → localStorage → collect.js handoff (7/7 assertions):
- Save sources-only → does NOT write skip_reddit → next collect includes Reddit ✓
- Run (Reddit checked) → skip_reddit=false → Reddit fetched ✓
- Run (Reddit unchecked, confirmed) → skip_reddit=true → Reddit skipped as chosen ✓
- Fetch more after a stale Save → always includes Reddit ✓
- `node --check` on topic.js → clean; `confirmModal` import present.

The full chain (picker → collect.js → Rust `build_collect_args` → CLI
`research collect` → `collect()`) was confirmed correct: Reddit is gated solely
by `skip_reddit`, independent of `--sources`.

## Files Modified

- `app-tauri/src/screens/topic.js`
