# Sentiment loader no longer resets to 0 when you leave the tab and return

**Date:** 2026-05-31
**Type:** Fix (UX)

## Summary

Reported: "open the Sentiment tab, switch to another tab within ~1s, come
back — it starts loading from 0 fresh." Root-caused to a UI-state issue, not
a backend restart.

The sentiment LLM run is correctly guarded by a module-level `_sentimentRunning`
Set, so a fast switch-away-and-return does **not** re-fire
`runSentimentBySource` — the analysis keeps running. But the "Analyzing
sentiment" loader derived its elapsed counter, progress bar, and stage message
from `startedAt = Date.now()` captured **locally inside each
`renderAnalyzingState` call**. On tab re-entry the loader is re-mounted (the
tab's cached DOM is cleared by the `openreply:db-changed` events the run itself
emits as it persists per-source rows, so `restoreTabDom` fails and
`loadSentiment` re-runs), so `startedAt` reset to "now" → the loader flashed
back to `0s elapsed / 0% / "Connecting to LLM…"`. That *looked* like a fresh
restart even though the backend call continued.

## Fix

Persist the run's real start timestamp per topic and thread it through the
loader so a re-mount continues from the actual elapsed time.

- Added a module-level `_sentimentRunStart` Map (topic → start ms), set/cleared
  in lockstep with `_sentimentRunning`.
- Extracted a pure, exported `sentimentLoaderProgress(startedAtMs, nowMs)`
  helper returning `{ elapsedSec, pct, stageIdx }` (same asymptotic
  `1 - e^(-t/45)` curve, capped at 90%, stage = elapsed/9).
- `renderAnalyzingState(contentEl, { headline, startedAt })` now accepts the
  real start time, paints correct elapsed/progress/stage on the first frame
  (no more "0s" flash), and drives the 1s tick from the helper.
- `runAndRender(contentEl, topic, startedAt)` and the "(in another tab)"
  re-entry branch both pass the persisted `_sentimentRunStart.get(topic)`.

Net behaviour: leaving and returning to the Sentiment tab mid-run now shows
the loader continuing (e.g. "32s elapsed", ~50%), and the already-landed
per-source cards still repopulate from the DB via the existing live-poll.
The LLM call was never restarting; now the UI reflects that truthfully.

## Files Modified

- `app-tauri/src/screens/sentiment.js` — `_sentimentRunStart` map, exported
  `sentimentLoaderProgress` + `SENT_STAGES`, `startedAt`-aware
  `renderAnalyzingState`, threaded start time through `runAndRender` and the
  in-flight re-entry branch.
- `app-tauri/package.json` — registered the new test in the `test` script.

## Files Created

- `app-tauri/src/screens/sentiment.progress.test.mjs` — regression test for the
  progress formula, incl. "re-entry after ~1s reflects real elapsed, not 0".

## Verification

- `node --test sentiment.progress.test.mjs` — 5/5 pass.
- `npm test` — **45/45 pass** (was 40; +5 new).
- `npm run build` — succeeds.
- `node --check src/screens/sentiment.js` — clean.
