# Shared analyzing-loader: persistent run-start across re-mounts

**Date:** 2026-05-31
**Type:** Fix (UX) / Infrastructure

## Summary

Generalizes yesterday's sentiment-loader fix (changelog `2026-05-31_01`) into
the shared `lib/analyzingLoader.js` that every other LLM-backed tab uses
(Empathy, Improve, Launch, PRD, Insights, Concepts, Solutions).

The shared `renderAnalyzingState` derived its elapsed counter / progress bar /
stage message from `startedAt = Date.now()` captured **locally per mount**, so
any re-mount of the loader (e.g. switching a topic tab away and back mid-run)
restarted it at `0s / 0% / stage-0` — the same class of bug reported for
Sentiment, now fixed at the source so it can't recur as screens adopt the
shared loader.

## Changes

- Added a module-level run-start registry keyed by an optional `runKey`, so a
  re-mount with the same key continues from the run's REAL elapsed time.
  Keys auto-expire after 15 min (a leaked/never-cleaned-up run can't pin a
  future fresh run to a stale start).
- Extracted a pure, exported `analyzingProgress(startedAtMs, nowMs, opts)`
  helper → `{ elapsedSec, pct, stageIdx, stageStepSec }` (same asymptotic
  `1 - e^(-t/τ)` curve, capped at 90%; stage cadence sized to median runtime).
- `renderAnalyzingState(contentEl, opts)` now accepts `opts.runKey` (registry-
  managed) **or** `opts.startedAt` (caller-managed), paints correct
  elapsed/progress/stage on the first frame (no "0s" flash on re-mount), drives
  the 1s tick from the helper, and clears the `runKey` on cleanup so the next
  fresh run starts at 0.
- Fully backward-compatible: with no `runKey`/`startedAt` the behaviour is
  identical to before (start = now).

## Files Modified

- `app-tauri/src/lib/analyzingLoader.js` — run-start registry, exported
  `analyzingProgress` helper, `runKey`/`startedAt`-aware `renderAnalyzingState`.
- `app-tauri/package.json` — registered the new test.

## Files Created

- `app-tauri/src/lib/analyzingLoader.progress.test.mjs` — 5 regression tests,
  incl. "re-mount after ~1s reflects real elapsed, not 0".

## Verification

- `node --test analyzingLoader.progress.test.mjs` — 5/5 pass.
- `npm run build` — succeeds (all 7 consumers import cleanly).
- `node --check src/lib/analyzingLoader.js` — clean.

## Follow-up (not in this change)

Consumers can now opt in by passing `runKey: '<tab>:<topic>'`. To make a tab
actually *re-show* its loader on re-entry mid-run (rather than re-painting the
empty CTA), each `loadX` also needs to check an in-flight run and re-mount the
loader — a per-screen change tracked separately.
