# UI polish — skeleton fade-in, keyboard shortcuts panel, sidecar retry

**Date:** 2026-04-19
**Type:** UI Enhancement + Fix (reliability)

## Summary

Three small UX + reliability improvements from the roadmap's Phase B polish list:
1. `.fade-in` utility class that smooths the "pop" when real data replaces a skeleton card (160 ms opacity + 2 px slide); applied to Dashboard hero + stat cards.
2. `?` keyboard shortcut opens a help panel listing every global shortcut (`⌘ N`, `?`, `Esc`, `Enter`, `Tab`/`Shift+Tab`). Panel has focus trap + restores focus on close; input-focus is a no-op so it doesn't hijack typing.
3. `api.js` now retries any transient sidecar failure once after 500 ms. Only matches a whitelist of patterns (`spawn failed`, `ECONNRESET`, `ECONNREFUSED`, `timed? ?out`, `broken pipe`, `resource temporarily unavailable`, `bad file descriptor`) — genuine logic errors pass through unchanged so the user still sees them.

## Changes

### Skeleton → data fade
- `style.css` — new `.fade-in` keyframe animation (160 ms ease-out, opacity 0 → 1 + 2 px translate). Guarded by `@media (prefers-reduced-motion: reduce)`.
- `home.js::renderHero` — `.hero` element now includes `fade-in`.
- `home.js::renderStatGrid` — every `.stat-card` now includes `fade-in`.

### Keyboard shortcuts panel
- `main.js::wireKeyboard` — bails out when target is an `INPUT`/`TEXTAREA`/`contentEditable`, so typing `?` in a topic name doesn't open the panel.
- `main.js::openShortcutsHelp` — new function: appends a `.modal-backdrop` + `.modal` to body, wires Escape + backdrop-click close, restores focus on close, auto-focuses the close button on open.
- `style.css` — new `.shortcuts-list`, `.shortcut-row`, `kbd` styles (mac-style key caps).

### Sidecar retry
- `api.js::invokeWithRetry` wraps every `cachedInvoke` call. On a matching transient error, waits 500 ms then re-invokes once. Non-transient errors propagate immediately.
- Pattern list is a single source of truth (`TRANSIENT_PATTERNS`) so reviewers can audit what qualifies.

## Expected impact

| Scenario | Before | After |
|---|---|---|
| Dashboard first paint | skeleton → data pops in instantly | skeleton → data fades in (160 ms) |
| User hits `?` on any screen | nothing | shortcut help panel opens |
| Sidecar briefly unavailable (Python import hiccup) | user sees error toast | silent 500 ms retry, then result |
| Real logic error (e.g. no such table) | surfaces | still surfaces (no retry on logic errors) |

## Files Modified

- `app-tauri/src/style.css` — `.fade-in` keyframe, `.shortcuts-list` + `kbd` styles
- `app-tauri/src/screens/home.js` — `fade-in` on hero section + stat-card
- `app-tauri/src/main.js` — input-aware keyboard handler + `openShortcutsHelp()`
- `app-tauri/src/api.js` — `invokeWithRetry` + transient-error patterns
- `docs/openreply-roadmap.md` — done/remaining checkboxes updated
