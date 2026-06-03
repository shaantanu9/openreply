# Two-phase collect: fast sources first, Reddit enriched in the background

**Date:** 2026-06-03
**Type:** Feature / Performance

## Summary

Reddit's first fetch for a topic takes ~15 min (sub discovery + top/search +
historical across many subs). Previously a collect that included Reddit blocked
the whole run — and therefore the gap graph + AI conclusions — on that, so the
user stared at a spinner for ~15 min before seeing anything.

Now reddit-including collects run in **two phases**:
- **Phase 1 (foreground):** the fast external sources run with Reddit **skipped**
  → posts land in ~2-3 min → the existing long-lived **enrich worker** builds the
  graph + conclusions → the user sees results almost immediately.
- **Phase 2 (background):** when Phase 1's `collect:done` fires, a **Reddit-only**
  collect is kicked for the same topic (queued, non-blocking). Its posts get
  tagged + enqueued and the **same** enrich worker folds them into the existing
  graph incrementally — the map just gets richer. A small non-blocking banner
  shows "Fetching Reddit… results update automatically".

Time-to-first-insight drops from ~15 min → ~2-3 min; Reddit data still arrives,
just off the critical path. Reuses the existing `startCollect` command + enrich
worker — no pipeline surgery. Phase 1 alone is a complete, valid collect, so if
Phase 2 fails to launch the user keeps full results.

## Changes

- New `app-tauri/src/lib/redditEnrich.js`:
  - `markRedditPending(topic, {aggressive})` — set before Phase 1.
  - `wireRedditEnrich()` — listens on the global `gapmap:collect-done-global`
    bus; on a **successful** (`code 0`) Phase-1 done for a topic with a pending
    Reddit pass, kicks `startCollect(topic, aggressive, '' /*no external*/, false
    /*reddit on*/, 'queue')`, sets the active-collect topic so its events are
    attributed, starts the enrich worker (idempotent), and shows/clears the
    background banner. Guards against duplicate Reddit passes + re-triggering on
    the Reddit pass's own done event.
- `app-tauri/src/main.js`: new-topic flow — when the chosen intent profile wants
  Reddit AND has external sources, force Phase 1 to `skip_reddit=true` + call
  `markRedditPending`. Reddit-only or external-only profiles are unchanged.
- `app-tauri/src/style.css`: `.re-banner` (fixed bottom-left, pulsing Reddit-orange dot, dismissible).

## Verification

- `npm test` → 50/50 · `node --check` clean · `npm run build` OK.
- Topic-key match confirmed: `setActiveCollectTopic(topic)` uses the same URL
  topic that `markRedditPending` keys on, so the chaining fires correctly.

## Needs a live smoke test
This changes the core collect UX, so the two chained collects + enrich-worker
fold-in + banner lifecycle should be validated via `npm run tauri:dev` (or a test
DMG) before shipping a release.

## Files Created
- `app-tauri/src/lib/redditEnrich.js`

## Files Modified
- `app-tauri/src/main.js`
- `app-tauri/src/style.css`
