# Loader UX rollout — launch / improve / iterate screens

**Date:** 2026-05-31
**Type:** UI Enhancement

## Summary

Replaced dead text placeholders (`loading…`, `Loading…`, `Loading run …`) with
shape-matching skeleton builders from `src/lib/skeleton.js`, and gave the
previously-silent async action buttons on the Iterate screen inline busy
feedback via `withButtonBusy` from `src/lib/busyButton.js`. The existing rich
`renderAnalyzingState` loaders on launch.js (launch-brief generation) and
improve.js (full-pipeline run) were left fully intact.

## Changes

- **launch.js** — imported `skelDetail`. Swapped the cached-brief detail load
  placeholder and the topic-picker load placeholder for `skelDetail(...)`.
  Existing `renderAnalyzingState` rich loader for `generateAndRender` left
  intact. Picker `launch-go` / build buttons drive the rich loader or are sync
  navigation, so no button-busy was added.
- **improve.js** — imported `skelStats`, `skelDetail`. Added `skelStats(4)`
  before the `pipelineStatus()` fetch in `refreshAndPaint` (was blank during
  load), and swapped the picker load placeholder for `skelDetail(4)`. Existing
  `renderAnalyzingState` rich loader for `runPipeline` left intact; the
  run/refresh buttons are replaced by that loader so no button-busy added.
- **iterate.js** — imported `skelRows`, `skelDetail`, `withButtonBusy`. Swapped
  three dead loaders: run-detail load → `skelDetail(5)`, topic-runs load →
  `skelRows(6)`, picker load → `skelRows(6)`. Wrapped `run-cancel`
  (Cancelling…), `run-apply` (Applying…), and the `launch()` run-loop buttons
  (Starting…) with `withButtonBusy` — the hand-rolled disable/Running… in
  `launch()` was replaced so the label restores correctly on error. The
  `running…` status pill (real run status) was NOT touched.

## Files Modified

- `app-tauri/src/screens/launch.js` — skelDetail import + 2 placeholder swaps
- `app-tauri/src/screens/improve.js` — skelStats/skelDetail import + skeleton before status fetch + picker swap
- `app-tauri/src/screens/iterate.js` — skeleton imports + withButtonBusy import; 3 placeholder swaps + 3 action buttons wrapped
