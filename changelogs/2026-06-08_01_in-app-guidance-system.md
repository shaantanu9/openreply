# In-app guidance system — tour, inline help, next-step rail, help hub

**Date:** 2026-06-08
**Type:** Feature

## Summary

Added a full in-app guidance system to make the ~70-screen, 2-mode app learnable for
both non-technical users and developers. Five parts, all vanilla JS with no new
dependencies, reusing the existing onboarding wizard, per-page explainers, and
playbook: (1) a coachmark/spotlight tour engine, (2) an auto-once first-run "Getting
Started" tour, (3) an inline help popover on every page's eye-icon (replacing the
navigate-away behavior), (4) a persistent "next step" rail that always shows the single
best action for the user's state, and (5) a `/help` hub. Design doc:
`docs/superpowers/specs/2026-06-08-in-app-guidance-design.md`.

## Changes

- **Tour engine** (`lib/tour.js`): spotlight overlay + tooltip bubble, declarative
  steps, route-aware steps, selector-timeout auto-skip (never traps the user),
  localStorage completion, Esc/arrow keys, reduced-motion support.
- **Tours + first-run** (`lib/tours.js`): "Getting Started" steps (comma-selectors so
  one tour works across both home modes), per-screen mini-tours (topic/collect/
  sentiment), `maybeStartFirstRunTour()` (auto-once), `replayGettingStarted()`.
  `welcome.js markOnboardingComplete()` now queues the tour.
- **Inline help popover** (`lib/helpPopover.js`): clicking the eye-icon opens a popover
  (page purpose from the why-registry + "Show me around" mini-tour + links to full
  explainer and Help center) instead of navigating away. Installed once at boot.
- **Next-step rail** (`lib/nextStep.js`): dismissible banner; 0 topics → "Research your
  first topic", topics-but-no-tour → "Take the tour", topic with posts-but-no-insights
  → "Open Insights". Mounted by the router after each render.
- **Help hub** (`screens/help.js` + `/help` route + nav link): replay the tour, the
  product-flow playbook, tips, and an index of every screen explainer.
- **Router wiring** (`main.js`): mount next-step rail + first-run tour after render;
  `/help` route + title; `initHelpPopover()` at boot.
- **CSS** (`style.css`): tour overlay/bubble, next-step rail, help popover, help hub.
- **Test** (`lib/tour.test.mjs`): tour done-persistence + storage-failure safety;
  registered in `package.json`.

## Files Created

- `app-tauri/src/lib/tour.js`, `lib/tours.js`, `lib/nextStep.js`, `lib/helpPopover.js`
- `app-tauri/src/lib/tour.test.mjs`
- `app-tauri/src/screens/help.js`
- `docs/superpowers/specs/2026-06-08-in-app-guidance-design.md`
- `changelogs/2026-06-08_01_in-app-guidance-system.md`

## Files Modified

- `app-tauri/src/main.js` — imports, `/help` route + title, rail + tour hooks, `initHelpPopover()`.
- `app-tauri/src/screens/welcome.js` — queue first-run tour on completion.
- `app-tauri/index.html` — Help nav link.
- `app-tauri/src/style.css` — guidance-system styles.
- `app-tauri/package.json` — register tour test.

## Verification

- `node --check` clean on all new/edited JS; no circular imports.
- Full JS suite: 52/52 pass (incl. new tour tests; existing onboarding test still green).
- Confirmed reused API methods exist (`listTopics`, `topicCountsBundle`,
  `pageExplanationGet`, `pageExplanationsList`).

## Notes / follow-ups

- Mini-tours currently cover topic/collect/sentiment; add more screens over time by
  extending `MINI_TOURS` in `lib/tours.js`.
- GUI not run headlessly here — logic/units verified; recommend a manual fresh-profile
  pass (tour auto-starts once, skip works, replay from Help works, popover opens).
