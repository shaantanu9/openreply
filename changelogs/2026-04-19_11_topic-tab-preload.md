# Topic page — preload tab data so clicks paint instantly

**Date:** 2026-04-19
**Type:** Fix (performance)

## Summary

Topic detail page has 6 lazy-loaded tabs (Map / Report / Evidence / Sources / Chat / Actions). Each tab fired its own sidecar queries when clicked, so switching tabs triggered a fresh Python process spawn (~300–500 ms in dev) even though the underlying SQLite is local. Added a fire-and-forget preload on topic mount that warms the `api.js` cache for Evidence, Sources, and Chat gating queries in parallel — by the time the user clicks any of those tabs, data is already in memory and paints instantly.

## Changes

- **Preload** in `renderTopic()` kicks off 7 parallel cached calls immediately after the header stats fetch:
  - `getFindings(topic, 'painpoint' | 'feature_wish' | 'product' | 'workaround')` — populates Evidence cache
  - `runQuery(srcSql, topic)` + `runQuery(subsSql, topic)` — populates Sources cache
  - `byokStatus()` — populates Chat gate cache
- Uses the new `api.js` cache (5 s TTL + in-flight dedup), so:
  - Clicking a tab while preload is still running = share promise, one process spawn total.
  - Clicking a tab after preload = 0 ms (memory hit).
- Cleaned up 2 remaining inline styles on header buttons (Rerun collect, Delete) → `.btn-sm btn-bordered`.

## Expected impact

| Action | Before | After |
|---|---|---|
| Open topic → click Evidence immediately | ~500 ms × 4 findings = ~500 ms wall-time | 0 ms if preload done, else shared promise (1 spawn) |
| Open topic → click Sources immediately | ~500 ms × 2 queries | 0 ms if preload done |
| Open topic → click Chat immediately | ~500 ms (byokStatus + runQuery gate) | 0 ms if preload done |
| Tab-click → tab-click (within 5 s) | respawn every time | memory cache, instant |

## Files Modified

- `app-tauri/src/screens/topic.js` — preload block after header fetch; header button inline styles cleaned up
