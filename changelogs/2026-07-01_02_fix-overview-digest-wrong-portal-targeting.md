# Fix Overview sections painting into the wrong tab's portal

**Date:** 2026-07-01
**Type:** Fix

## Summary

With the per-(tab,hash) portal cache, each open tab keeps its own Overview
portal, so several DOM nodes share each `ov-*` id. Every async painter in
`renderOverview` resolved its target with the **global**
`document.getElementById("ov-…")`, which returns the *first* matching node in the
document — often a hidden, stale portal from another tab. So the daily-update
digest (and opportunities, drafts, personas, strategy) painted into the wrong
portal and the visible tab's section stayed blank. (Complementary to the
"instant first paint" change in 3c00c47, which improved first paint but did not
scope the lookups.)

## Changes

- Scoped all 16 `document.getElementById("ov-…")` lookups in `renderOverview` to
  `view.querySelector("#ov-…")`. `view` is the specific portal this render owns,
  so each async paint and handler targets the correct tab's portal regardless of
  how many overview portals the cache holds.
- Covers: ov-refresh / ov-evolve / ov-suggest, ov-strategy, ov-digest
  (+ -clear / -search / -refresh), ov-kpi-opps / ov-opps, ov-kpi-drafts /
  ov-drafts, ov-personas, ov-plink* controls.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `renderOverview` DOM lookups scoped to `view`.

## Notes

- Re-applied fresh on current `public-main` (the earlier
  `fix/overview-digest-portal-cache` branch was based on `d383de5`, before
  `3c00c47` rewrote the digest code, so it would have conflicted).
- Verified with `node --check`.
