# Phase-A Collect Progress Card + Threshold Flip

**Date:** 2026-04-20
**Type:** UI Enhancement

## Summary

Rebuilt the top of the `#/collect/<topic>` screen to show a big Phase-A
"Gathering evidence" hero card with a live `N / 100` progress bar, per-source
chips, rate-based ETA, and a live findings counter that appears when the
topic crosses the 100-post threshold. The flip is mid-render (DOM nodes
persist; a CSS class swap animates the border to orange and slides in the
new copy). Wires new Tauri `enrich:tick` events into the existing
`gapmap:changed` reactive layer so the card and every other open tab see new
findings as the extraction worker commits batches. Part of Task 7 of the
incremental-enrichment plan.

## Changes

- Phase-A card with live post count, per-source chips, threshold bar, and
  rate-based ETA that reads `posts/sec` since mount.
- Phase-B flip at `PHASE_B_THRESHOLD = 100` posts — heading swaps to
  "Extracting insights…", findings chip appears, card border animates to
  orange, secondary copy "Keep collecting — new posts auto-improve the
  graph." slides in.
- Freshness badge at bottom: "Last finding: Xs ago" ticks once a second.
- 2s poll of `topic_posts` + `graph_nodes` via `api.runQuery` for
  authoritative counts; source log lines seed the count optimistically so
  the bar climbs from second 1.
- `listen('enrich:tick', …)` via a dynamic `@tauri-apps/api/event` import
  (guarded for non-Tauri test runtime). Topic-scoped — ticks for other
  topics only refresh the freshness badge, no DB roundtrip.
- `window.addEventListener('gapmap:changed', …)` updates counts on
  kind='findings' / 'collect' / 'graph'.
- `routeGen` gate on every async callback so stale events don't mutate DOM
  after the user navigates away. Listeners cleaned up on `hashchange`.
- Existing stage strip, source chips, log, Cancel button, and collect-done
  enrich/export flow preserved intact — the new card sits above the old
  detail card.

## Files Created

- `changelogs/2026-04-20_15_phase-a-collect-progress-card.md`

## Files Modified

- `app-tauri/src/screens/collect.js` — new phase-card DOM, post-count/
  findings-count tracking, enrich:tick + gapmap:changed subscriptions, flip
  animation, freshness badge, cleanup on hashchange.
- `app-tauri/src/style.css` — new `.phase-card`, `.phase-bar`, `.phase-copy`,
  `.phase-freshness`, `.phase-findings-pop` styles + `phaseFlipIn` and
  `phaseFindingsPop` keyframes.
