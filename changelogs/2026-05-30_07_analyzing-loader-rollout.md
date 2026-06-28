# Loaders: shared "Analyzing…" loader rolled out to LLM tabs

**Date:** 2026-05-30
**Type:** UI Enhancement

## Summary

The alive-feeling five-element loader (spinner + live elapsed counter + cycling stage messages + asymptotic progress bar + skeleton cards) existed only inline in `sentiment.js`. Extracted it to a shared `lib/analyzingLoader.js` + namespaced `.gm-az-*` CSS, then adopted it on every tab whose 5+ second blocking LLM call previously showed dead text ("Loading…", "Re-running…", "Generating…"). Tabs whose loaders wrap sub-second SQLite reads / deterministic math were correctly left alone.

## Changes

- New `app-tauri/src/lib/analyzingLoader.js`: `renderAnalyzingState()`, `startLivePolling()`, `kickAndPoll()`, `genericSkeletonCard()`, `DEFAULT_STAGES`.
- New `.gm-az-*` CSS block (generic version of the `.sent-*` loader).
- Adopted on: concepts, solutions, insights (2 run-sites), empathy (2 run-sites), prd, launch, improve — each with domain-specific stage messages and the `stop({snapToComplete})` cleanup contract.
- Verified already-alive / correctly-skipped: sentiment + audience/personas (already kick+poll w/ incremental persist), iterate (background-job polling), science/ost/pmf/pricing/estimate (fast reads only — no blocking LLM call).

## Files Created

- `app-tauri/src/lib/analyzingLoader.js`

## Files Modified

- `app-tauri/src/style.css` — `.gm-az-*` loader styles
- `app-tauri/src/screens/concepts.js`
- `app-tauri/src/screens/solutions.js`
- `app-tauri/src/screens/insights.js`
- `app-tauri/src/screens/empathy.js`
- `app-tauri/src/screens/prd.js`
- `app-tauri/src/screens/launch.js`
- `app-tauri/src/screens/improve.js`

## Verification

`npm run build` succeeds; `node --check` passes on every touched file.
