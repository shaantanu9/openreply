# Sidebar nav search + Settings search

**Date:** 2026-06-27
**Type:** UI Enhancement

## Summary

Added two working search affordances to the OpenReply Tauri UI, matching the
rest of the app's design. A search box in the sidebar (under the active-agent
switcher) filters the navigation as you type; a search box on the Settings page
filters the settings cards. Both are real DOM filters — no placeholders.

## Changes

- **Sidebar search** (`shell.js`): search input below the agent switcher.
  - Filters all nav links by label as you type (case-insensitive substring).
  - Hides section headers (AGENT / Intelligence / Account) that have no visible
    items under them.
  - `Enter` navigates to the first visible match; `Esc` clears the filter.
- **Settings search** (`dynamic.js`, `renderSettings`): search input above the
  settings grid.
  - Each card tagged with `data-skw` keywords (licence, provider, theme, feeds,
    data) and matched against keywords + visible text.
  - Non-matching cards hide; an empty-state hint shows when nothing matches.

## Files Modified

- `app-tauri/src/or/shell.js` — sidebar search box + filter/keyboard wiring
- `app-tauri/src/or/dynamic.js` — Settings search box, `data-skw` card tags,
  filter wiring

## Files Created

- `changelogs/2026-06-27_19_sidebar-and-settings-search.md`
