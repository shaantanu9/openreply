# Per-Page First-Open Tutorials + "Tour this page" Shortcut

**Date:** 2026-06-17
**Type:** Feature (UX)

## Summary

The first time a user opens any page — a top-level route **or** a topic-detail
tab — Gap Map now auto-runs a short **spotlight tour** demoing what the page does
and its key actions. Coverage is universal: ~10 core pages get hand-authored
multi-step tours; every other page auto-generates a tour from the existing
backend page-explanations (`api.pageExplanationGet`). Pressing **`?`** opens the
shortcuts panel, now topped with a **"🎓 Tour this page"** button (and "Replay
getting-started") so any page's tour can be replayed on demand. A Settings toggle
disables auto-tours, and a button resets the per-page "seen" flags.

This is a thin coordinator over existing infrastructure — the `lib/tour.js`
spotlight engine, the eye-icon help popover, the `route()` dispatcher, and
`topic.js::switchTab()`. No new overlay engine, no backend changes.

## Changes

- **New `lib/pageTours.js`** — the coordinator:
  - `currentPageKey()` — page identity: top-level routes use the screen's
    why-slug (read from the mounted `.why-eye-btn`); topic tabs use `tab:<dataTab>`.
  - `resolvePageTour(key)` — hand-authored (`PAGE_TOURS`) → built from
    `api.pageExplanationGet` → null.
  - `maybeAutoRunPageTour(key)` — first-open auto-run, guarded by: auto-tours
    pref, onboarding-complete, not on welcome/activate, not already seen, no
    active tour, getting-started-not-pending; fires after a settle delay with a
    stale-page re-check. Never throws into its caller.
  - `runPageTour(key, {force})` and `resetAllPageTours()`.
  - Hand-authored tours for `tab:home`, `tab:map`, `tab:papers`, `tab:academic`,
    `tab:research`, `settings`, `reports`, `chats`, `collect`.
- **`lib/tour.js`** — added `isTourActive()`.
- **`main.js`** — route dispatcher calls `maybeAutoRunPageTour()` for top-level
  pages after render; the `?` shortcuts modal gains the "Tour this page" +
  "Replay getting-started" CTA and wiring.
- **`screens/topic.js`** — `switchTab()` calls `maybeAutoRunPageTour('tab:'+name)`
  (one tour per tab, once).
- **`lib/helpPopover.js`** — the eye-icon "Show me around" now always shows and
  routes to `runPageTour(currentPageKey())`, so it works on every page (not just
  the 3 legacy mini-tours).
- **`screens/settings.js`** — "Auto-show page tours" toggle
  (`gapmap.pref.auto_tours`) + "Reset page tours" button in the Onboarding & help
  card.
- **`style.css`** — `.shortcuts-tour-cta` styles for the modal CTA row.

## Files Created

- `app-tauri/src/lib/pageTours.js`
- `app-tauri/src/lib/pageTours.test.mjs` (13 tests)
- `docs/superpowers/specs/2026-06-17-per-page-tours-design.md`
- `changelogs/2026-06-17_01_per-page-first-open-tours.md`

## Files Modified

- `app-tauri/src/lib/tour.js` — `isTourActive()`.
- `app-tauri/src/main.js` — route hook + `?` modal CTA + wiring.
- `app-tauri/src/screens/topic.js` — `switchTab` per-tab hook + import.
- `app-tauri/src/lib/helpPopover.js` — eye-icon "Show me around" → per-page tour.
- `app-tauri/src/screens/settings.js` — auto-tours toggle + reset button + wiring.
- `app-tauri/src/style.css` — modal tour-CTA styles.
- `app-tauri/package.json` — `pageTours.test.mjs` in the test list.

## Persistence / keys

- `gapmap.tour.page.<key>.done` — per-page seen flag (engine-managed).
- `gapmap.pref.auto_tours` — `'false'` disables auto-run (default on).

## Verification

- `node --test pageTours.test.mjs` → 13 passed (page-key mapping, resolve
  precedence, explanation fallback + graceful failure, auto-run guards, reset).
- `npm test` → **73 passed**.
- `npm run build` → `✓ built` (only pre-existing dynamic/static import warnings).

## Notes

- Page identity reuses the existing per-screen why-slug, so the ~43 screens with
  backend explainers get an auto-tour immediately; tabs without an explainer and
  without a hand-authored tour simply don't auto-run (no error).
- Home is intentionally left to the existing getting-started tour (no double-up).
