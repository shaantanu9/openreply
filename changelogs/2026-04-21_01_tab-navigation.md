# Chrome-style tab navigation

**Date:** 2026-04-21
**Type:** Feature

## Summary

Adds a persistent tab strip at the top of Gap Map, Chrome-style. Users keep multiple screens open simultaneously, right-click for a native-feel context menu (Reload / Duplicate / Close / Close others / Close to right), drag tabs to reorder, and get the usual keyboard shortcuts (⌘T / ⌘W / ⌘⇧T / ⌘1..9). Tab state + active tab + per-tab scroll survive app restart via `localStorage`.

Also fixes two regressions introduced while wiring tabs: (1) default home page not rendering because the tab strip was inserted as a third child of the 2-column `.app` grid, pushing `<main>` into the wrong cell; wrapped strip + main in a new `.main-col` flex column. (2) Missing dark-mode styles for the strip and context menu; added explicit `html.dark` rules so both themes align with the rest of the chrome.

## Changes

- New frontend module `app-tauri/src/lib/tabs.js` — tab store (open / close / focus / duplicate / move / reopen-last-closed), `renderTabStrip(host)` with click / middle-click / right-click / drag handlers, `titleForHash()` + `iconForHash()` resolvers
- New reusable `app-tauri/src/lib/contextMenu.js` — `openContextMenu(x, y, items)` primitive with auto-close on outside click / Escape / window scroll / resize, viewport clamping
- `app-tauri/index.html` — wrapped `<main>` in `<div class="main-col">` so the tab strip and main content share grid column 2
- `app-tauri/src/main.js` — router reconciles hash ↔ active tab, saves scroll on tab blur + restores on focus, intercepts cmd/middle/right-click on nav links and topic tiles, adds ⌘T / ⌘W / ⌘⇧T / ⌘1-9 shortcuts via a second `keydown` listener (tab ops bypass the "typing in input" guard so ⌘W closes a tab even while typing)
- `app-tauri/src/screens/home.js` — topic tiles get `data-topic-href` so delegated right-click menu finds them (tiles are `<div>`, not `<a>`)
- `app-tauri/src/style.css` — tab-strip + context-menu base styles, 680px narrow-screen fallback, `.main-col` flex column, dark-mode variables for strip + context menu
- Spec + plan written before implementation: `docs/superpowers/specs/2026-04-21-tab-navigation-design.md`, `docs/superpowers/plans/2026-04-21-tab-navigation.md`
- `tests/tabs.spec.js` — minimal node test for `titleForHash` / `iconForHash`

## Commits

- `ba90640` Task 1: tab store + title/icon resolver
- `9726bd7` Task 2: reusable context menu primitive
- `2a3b9fd` Task 3: tab-strip + context-menu CSS
- `d38ef5b` Task 4: render strip with context menu + click/middle-click/close handlers
- `cdeb0d0` Task 5: router + tab store reconciliation + scroll restore
- `686b34b` Task 6: ⌘T / ⌘W / ⌘⇧T / ⌘1..9 shortcuts
- `3345f1b` Task 7: cmd/middle/right-click intercept on nav + topic tiles
- `dd1f31a` Task 8: drag to reorder within strip
- `d9c66f7` Fix grid layout + dark mode for tab strip + context menu

## Files Created

- `app-tauri/src/lib/tabs.js`
- `app-tauri/src/lib/contextMenu.js`
- `docs/superpowers/specs/2026-04-21-tab-navigation-design.md`
- `docs/superpowers/plans/2026-04-21-tab-navigation.md`
- `tests/tabs.spec.js`
- `changelogs/2026-04-21_01_tab-navigation.md`

## Files Modified

- `app-tauri/index.html`
- `app-tauri/src/main.js`
- `app-tauri/src/style.css`
- `app-tauri/src/screens/home.js`
