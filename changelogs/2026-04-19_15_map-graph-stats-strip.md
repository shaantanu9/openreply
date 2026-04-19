# Graph Stats Strip — Map Tab Header

**Date:** 2026-04-19
**Type:** Feature

## Summary

Adds a compact stats strip above the Map tab visualization showing per-kind node counts and total edge count. Suppresses `topic` and `post` kinds (too high-cardinality). The strip hides entirely when the graph is empty. Pure SQL via existing `api.runQuery` — no new Tauri command required.

## Changes

- Fetch node counts (grouped by kind, excluding `topic`/`post`) and edge count in parallel before map render inside `loadMap()`
- Build `statsStripHtml` with `.graph-stat-chip` spans per kind and a trailing edge count
- Inject `${statsStripHtml}` at the top of the success-branch `contentEl.innerHTML`, above the `.map-toolbar`
- If no qualifying nodes exist, `statsStripHtml` stays `''` and nothing is rendered
- Added `.graph-stats-strip`, `.graph-stat-chip`, and `.graph-stat-edges` CSS rules

## Files Modified

- `app-tauri/src/screens/topic.js` — stats fetcher added at start of `loadMap()`, strip injected into success branch
- `app-tauri/src/style.css` — `.graph-stats-strip` block appended at end of file
