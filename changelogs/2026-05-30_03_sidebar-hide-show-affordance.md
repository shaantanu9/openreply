# Sidebar: header toggle never fully hides + visible floating show button

**Date:** 2026-05-30
**Type:** UI Enhancement

## Summary

Users reported the sidebar minimize/icon button "hides the whole sidebar with no show button." The header toggle cycled full → rail → hidden → full, and the "hidden" state's only restore affordance was an invisible 8px hover strip at the screen edge that nobody could find. Reworked so the header toggle (and ⌘B) only swing **full ⇄ rail** — it can never make the sidebar vanish. The "hidden" state still exists (e.g. from a legacy persisted value) but is restorable via a clearly visible 36px floating "show" pill (top-left, `panel-left-open` icon, shadow + hover).

## Changes

- `cycleSidebar` now toggles only `full`/`rail`; if somehow in `hidden`, a click restores to `full`.
- Renamed the toggle state constants; rail's toggle icon/label now reads "Expand sidebar".
- Reveal button: invisible 8px hover strip → visible 36px floating pill with a lucide icon.

## Files Modified

- `app-tauri/src/main.js` — `SIDEBAR_TOGGLE_STATES`/`SIDEBAR_VALID_STATES`, `cycleSidebar`, `applySidebarState`, `initSidebarMinimize`
- `app-tauri/index.html` — `#sidebar-reveal-strip` gains a `panel-left-open` icon
- `app-tauri/src/style.css` — `.sidebar-reveal-strip` floating-pill styling + `body[data-sidebar="hidden"]` `display:flex` toggle
