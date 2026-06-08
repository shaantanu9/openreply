# Topic tabs open instantly + faster home dashboard

**Date:** 2026-06-08
**Type:** Fix

## Summary

Three reported issues, two root causes. (1) Every time a topic tab opened it
"kept loading", and (3) clicking a topic immediately showed an "Ideating the
product concept" loader — both caused by the same thing: **auto-run-on-open
defaulted to ON**, so opening a topic auto-fired a 30–90s blocking LLM job on
the active tab (insights on the default `home` tab; the Concept Agent on the
Concepts tab). If that LLM call hung (known to happen on big topics), the
loader never cleared. (2) The **home dashboard was slow** because it fired ~11
parallel loaders (~13 sidecar calls) at once, which contended on the single
sidecar-daemon mutex and cascaded into cold one-shot Python spawns.

Fixes: default auto-run to OFF (topics now open instantly to cached data or a
"Run" CTA; LLM pipelines run only on click), add a hard timeout so a hung
manual run shows an error+retry instead of an infinite spinner, and defer the
home dashboard's below-the-fold cards until after first paint.

## Changes

- **Auto-run defaults to OFF.** `isAutoRunEnabled()` now returns `false` when
  unset (was `true`). Opening any topic tab no longer auto-fires its blocking
  LLM pipeline — it paints existing/cached data instantly or shows the empty
  "Run" CTA. Users can opt back in via the "Auto-run pipelines when a tab is
  opened" toggle in the topic Actions tab. (Fixes issues #1 and #3 for every
  LLM tab at once: insights, concepts, solutions, papers, bets, etc.)
- **Timeout on blocking topic LLM calls.** New `lib/withTimeout.js` races the
  call against a 3-minute ceiling (well above the normal 30–90s). On a true
  hang the existing catch path shows an error + Run button instead of looping
  forever. Applied to `api.runConcepts` (Concepts) and `api.monitorRunTopic`
  (Insights synthesis).
- **Home dashboard: defer below-the-fold cards.** Hero, stats, topic grid,
  collect status and BYOK nudge fire immediately; weekly deltas, bets,
  opportunities, products and palace nudge are deferred to `requestIdleCallback`
  (fallback `setTimeout`) after first paint, guarded by route generation. This
  cuts the initial sidecar burst from ~13 to ~7 calls so the above-the-fold
  cards aren't starved by daemon-lock contention. (Fixes issue #2.)

## Files Created

- `app-tauri/src/lib/withTimeout.js` — `withTimeout()` + `TimeoutError` + `LLM_TAB_TIMEOUT_MS`

## Files Modified

- `app-tauri/src/lib/tabPipelines.js` — `isAutoRunEnabled()` defaults to `false`
- `app-tauri/src/screens/concepts.js` — wrap both `api.runConcepts` calls in `withTimeout`
- `app-tauri/src/screens/insights.js` — wrap `api.monitorRunTopic` in `withTimeout`
- `app-tauri/src/screens/home.js` — defer below-the-fold loaders to idle after first paint
