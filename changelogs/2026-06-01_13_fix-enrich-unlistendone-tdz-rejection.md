# Fix "Cannot access 'unlistenDone' before initialization" in enrich stream

**Date:** 2026-06-01
**Type:** Fix

## Summary

The painpoint-fetch and manual-fetch enrichment paths could throw an
`Unhandled Promise Rejection: ReferenceError: Cannot access 'unlistenDone'
before initialization`. In `runEnrichStreamForTopic`, the `enrich:stream:done`
listener referenced `unlistenDone` inside its own callback body while the
binding was declared with `const unlistenDone = await mod.listen(...)`. Until
the `await` resolved and assigned the binding, `unlistenDone` was in the
temporal dead zone (TDZ). If the done event fired in that window — likely on
fast-starting painpoint-only / manual runs — the callback accessed the binding
before initialization and threw.

## Changes

- Declared `unlistenProgress` and `unlistenDone` with `let … = null` BEFORE
  subscribing, matching the existing convention in `collect.js` and
  `ingest_video.js`. This removes the TDZ entirely — a pre-event callback now
  sees `null` and the `?.()` calls no-op safely.
- Converted the four bare `unlistenProgress()` / `unlistenDone()` call sites
  (done callback, manual-preempt branch, piggyback-unstick handler, start-error
  catch) to optional-chaining `?.()` so they tolerate the `null` initial value.
- Verified `node --check src/screens/topic.js` passes.

## Files Modified

- `app-tauri/src/screens/topic.js` — `runEnrichStreamForTopic` (around lines
  457-572): `const` → pre-declared `let` for the unlisten handles + optional
  chaining on all call sites.

## Note

The installed app runs from the built JS bundle — a frontend rebuild
(`npm run build`) and Tauri repackage are required for the fix to reach the
installed `/Applications/OpenReply.app`.
