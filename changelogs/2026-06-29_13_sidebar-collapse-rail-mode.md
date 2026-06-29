# Sidebar collapse / rail mode (public-main)

**Date:** 2026-06-29
**Type:** UI Enhancement

## Summary

Added a collapsible sidebar to the public-main shell, matching the minimize
behaviour from the `multi-source` branch but adapted to public-main's Tailwind
flex layout (no grid refactor). The sidebar now toggles between `full` (240px,
the existing layout) and `rail` (64px, icon-only). State is driven by a single
`body[data-sidebar]` attribute, persisted to `localStorage` (`or-sidebar.v1`),
and toggled via a collapse button in the brand row or the ⌘B / Ctrl+B shortcut.

## Changes

- New 2-state machine in `or/shell.js` (`full` ↔ `rail`): `applySidebarState()`,
  `currentSidebarState()`, `cycleSidebar()`, `initSidebar()`. State restores on
  every mount; the ⌘B/Ctrl+B keydown listener binds once and is ignored while a
  text input/textarea/contenteditable is focused. Exposed as
  `window.__orCycleSidebar`.
- Brand row reworked: "OpenReply" wrapped in `.brand-text`; added a
  `#side-collapse` toggle button whose icon (`panel-left-close` ↔
  `panel-left-open`) and title flip with the state.
- Nav links gained a `title` tooltip (so labels are reachable on hover in rail)
  and a `.nav-label` class on the label span (so rail can hide it).
- Rail-mode CSS in `styles.css`: shrinks `#side` to 4rem, hides brand text, the
  Active-agent card, search box, nav section headers, nav labels, inbox/tag
  badges, and the footer name/chevron; centres the nav icons and footer avatar.
  Selectors are `#side`-scoped so they outrank Tailwind utilities. Added a
  150ms width transition.

## Files Created

- `changelogs/2026-06-29_13_sidebar-collapse-rail-mode.md`

## Files Modified

- `app-tauri/src/or/shell.js` — sidebar state machine + brand-row toggle button
  + `initSidebar()` call in `mountShell()` + nav `title`/`.nav-label`.
- `app-tauri/src/styles.css` — `body[data-sidebar="rail"]` rail-mode rules +
  `#side` width transition.

## Verification

- `node --check src/or/shell.js` → syntax OK.
- `npx vite build` → built successfully; bundled CSS 42.0 → 44.3 KB (rail rules).
- Lucide `panel-left-close` / `panel-left-open` confirmed present in the bundled
  icon set (resolve to `PanelLeftClose` / `PanelLeftOpen`).
