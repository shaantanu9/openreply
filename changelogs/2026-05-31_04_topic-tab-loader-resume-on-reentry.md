# Topic sub-tabs resume their loader on re-entry (no reset, no double-run)

**Date:** 2026-05-31
**Type:** Fix (UX) / Fix (correctness)

## Summary

Applies the sentiment-loader fix pattern (changelogs `_01`, `_03`) to the
remaining auto-running topic sub-tabs: **Concepts, Solutions, Insights**.

Each of these auto-fires a blocking LLM pipeline when you open the tab with no
data yet. On re-entry (switch a tab away within ~1s and back, or a
`gapmap:db-changed` event re-running the loader) the screen's `loadX` re-ran
and — because there was still no persisted data — **hit the empty CTA path and
auto-fired the pipeline AGAIN**. So a fast tab bounce could double- (or triple-)
fire an expensive LLM call, and the alive loader visibly restarted from
`0s / 0% / stage-0`.

## Fix

Per-screen, mirroring `sentiment.js`'s proven `_sentimentRunning` guard:

- Added a module-level in-flight `Set` keyed by topic (`_conceptsRunning`,
  `_solutionsRunning`, `_insightsRunning`).
- The run functions early-return if the topic is already running (no
  double-fire) and clear the guard in `finally`.
- On re-entry with no data **and** a run in flight, `loadX` now re-shows the
  alive loader — passing a stable `runKey` (`<tab>:<topic>`) so the shared
  loader continues from the REAL elapsed time (changelog `_03`) — instead of
  repainting the empty CTA and kicking a second run.
- All `renderAnalyzingState` mounts on these tabs now pass `runKey`, so even the
  re-run buttons continue elapsed correctly across a tab bounce.

Net: open Concepts/Solutions/Insights, bounce tabs, come back → the loader
continues (e.g. "34s elapsed, ~50%"), the LLM call runs exactly once, and the
result paints when it lands.

## Files Modified

- `app-tauri/src/screens/concepts.js` — `_conceptsRunning` guard, re-entry
  loader branch, `runKey` on both loader mounts, `finally` cleanup.
- `app-tauri/src/screens/solutions.js` — `_solutionsRunning` guard (main
  pipeline), re-entry loader branch, `runKey`, `finally` cleanup.
- `app-tauri/src/screens/insights.js` — `_insightsRunning` guard shared by the
  fast (`runSynth`) and chunked (`runChunkedSynth`) paths, re-entry loader
  branch, `runKey`, `try/finally` cleanup.

## Verification

- `node --check` clean on all three.
- `npm test` — 50/50 pass.
- `npm run build` — succeeds.

## Notes

Sidebar route screens that use the same shared loader (Improve, Launch, PRD,
Empathy) show a dashboard / existing data on re-entry rather than re-mounting
the loader, so they don't exhibit the reset/double-run; they can adopt `runKey`
later if their flow changes. The shared loader (changelog `_03`) already
supports it.
