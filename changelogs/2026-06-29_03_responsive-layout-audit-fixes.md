# Responsive layout audit fixes (P1/P2)

**Date:** 2026-06-29
**Type:** UI Enhancement

## Summary

Closed the remaining P1/P2 layout findings from the full-app audit so screens
hold up at narrow widths and on short viewports. Wide data tables now scroll
horizontally instead of forcing the page wider than the window; the two-column
"brain"/"compose" and KPI grids use `minmax(0,1fr)` tracks so one wide cell can
no longer squeeze its sibling to zero; the injected modal can scroll when its
body is taller than the screen; the main content column can shrink cleanly; and
every reply/automation checkbox now uses the brand accent color. Done in an
isolated git worktree (`fix/p1-p2-audit`, based on `open-reply`) to avoid
colliding with the concurrent `public-main` session.

## Changes

- Wrapped all 9 `<table>` elements in `views.js` with `overflow-x-auto` (3 were
  already wrapped by an earlier pass; this completes the remaining 6 and fixes
  one wrap that had been left with an unclosed `</div>`).
- Changed the "brain" and "compose" grids plus the KPI-row skeleton to
  `lg:grid-cols-[minmax(0,1fr),…]` / `minmax(0,1fr)` tracks (skeleton.js,
  dynamic.js) per the `minmax(0,1fr)` grid rule in the
  `tauri-python-sidecar-app` skill (Phase 7).
- Added `max-h-[85vh] overflow-y-auto` to the `window.orModal` card so tall
  modals scroll instead of overflowing the viewport (shell.js).
- Added `min-w-0` to `#main-content` so the flex main column can shrink below
  its content width and truncate cleanly (index.html).
- Added `accent-reddit` to the automation/platform/threads checkboxes that were
  still using the default browser accent (dynamic.js: `ap-content`, `ap-opp`,
  the per-platform reply checkbox, `xa-with-threads`).

## Files Created

- (none)

## Files Modified

- `app-tauri/src/or/views.js` — wrapped 6 remaining tables in `overflow-x-auto`;
  closed a previously-unbalanced overflow wrapper on the "Tracked subreddits"
  table. Div tags now balance (263/263).
- `app-tauri/src/or/skeleton.js` — `brain`/`compose` skeleton grids use
  `minmax(0,1fr)` tracks.
- `app-tauri/src/or/dynamic.js` — `minmax(0,1fr)` on the agent-brain grid;
  `accent-reddit` on 4 checkboxes.
- `app-tauri/src/or/shell.js` — modal card gets `max-h-[85vh] overflow-y-auto`.
- `app-tauri/index.html` — `min-w-0` on `#main-content`.
