# Sidebar Minimize — Rail + Hidden States with ⌘B Toggle

**Date:** 2026-05-28
**Type:** Feature

## Summary

The Gap Map sidebar was a fixed 248px column with no way to reclaim
that screen real estate. Power-user requests on Map / Iterate /
Database screens that want maximum content width had no escape hatch
short of resizing the window or the browser zoom level.

Added a 3-state minimize cycle on the sidebar:

- **Full** (default, 248px) — original behavior, unchanged.
- **Rail** (~64px, icon-only) — nav icons stay visible, labels +
  counts + section headers + pro card hide. The existing `title`
  attributes on each nav link surface as native tooltips on hover so
  users can still discover destinations without labels.
- **Hidden** (0px, completely removed from layout) — sidebar is
  `display:none`. A subtle 8px hover-reveal strip on the left edge of
  the viewport expands back to "full" on click.

Three ways to trigger the cycle:
1. **Toggle button** in the sidebar header (icon + tooltip both
   describe the NEXT state in the cycle, so users know what their
   click will do).
2. **⌘B / Ctrl+B** keyboard shortcut — added to the existing
   Chrome-style keydown listener next to ⌘W / ⌘R. Fires even while
   typing in inputs (matches the Chrome-style group convention).
3. **Hover-reveal strip** on the left edge (only shown when the
   sidebar is hidden) — always jumps back to "full", because cycling
   through "rail" first when the user said "show me the sidebar"
   would be a confusing UX.

State persists to `localStorage['gapmap.sidebarState.v1']` so the
choice survives reload and new tabs.

## Changes

- New `body[data-sidebar="<state>"]` attribute drives layout via
  `~/.app` grid-template-columns swaps:
  - `full` → original `248px 1fr`.
  - `rail` → `64px 1fr` + hides `.brand-text`, `.nav-section-label`,
    all unclassed spans inside nav links (labels + counts), and
    `.pro-card`.
  - `hidden` → `0 1fr` + `display:none` on the sidebar.
- New `.sidebar-toggle` button mounted inside `.brand`.
- New `.brand-text` wrapper class added around the brand-name +
  brand-sub div so rail mode can hide them as a unit.
- New `.sidebar-reveal-strip` (fixed-position 8px → 16px on hover)
  outside `.app` so its positioning isn't clipped by the grid's
  overflow. Only `display:block` when `body[data-sidebar="hidden"]`.
- `main.js` gained:
  - `SIDEBAR_STATES` / `SIDEBAR_NEXT_META` registries.
  - `applySidebarState(state)` — sets the body attribute, persists
    to localStorage, swaps the toggle button's icon + title to
    describe the NEXT click.
  - `cycleSidebar()` — advances through the 3-state cycle.
  - `initSidebarMinimize()` — DOMContentLoaded bootstrap that
    restores saved state, wires the toggle button + reveal strip
    clicks, and exposes `window.__cycleSidebar` for the ⌘B handler.
  - One new branch in the existing Chrome-style keydown listener for
    `e.key === 'b' || 'B'` → calls `window.__cycleSidebar()`.

## Files Created

- `changelogs/2026-05-28_04_sidebar-minimize.md`

## Files Modified

- `app-tauri/index.html` — added `.brand-text` wrapper class,
  `#sidebar-toggle` button inside `.brand`, and `#sidebar-reveal-strip`
  at end of body.
- `app-tauri/src/style.css` — appended the sidebar-toggle, rail-state,
  hidden-state, and reveal-strip rules at end of file.
- `app-tauri/src/main.js` — added `⌘B / Ctrl+B` branch in the existing
  keydown shortcut listener; appended the state machine + init at end
  of file.

## Verification

- `node --check src/main.js` → clean.
- `npm test` → 29/29 passed.
- No edits to files with pre-existing WIP (`commands.rs`, `settings.js`,
  the other side of `index.html` line 148 URL swap, etc.).

## Manual Test Notes

- Open the app (`cargo tauri dev`).
- Click the panel-left-close icon in the sidebar header → sidebar
  shrinks to the icon-only rail. Hover any nav icon → see its label
  as a native tooltip.
- Click again → sidebar fully hides. Mouse to the left edge of the
  window → 8px hover strip widens to 16px with a subtle orange tint.
- Click the strip → sidebar returns to full.
- ⌘B (mac) / Ctrl+B (other) cycles through the same three states.
- Reload the app — the last state is restored from localStorage.
