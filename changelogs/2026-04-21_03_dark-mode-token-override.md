# Dark mode: token override block + inline-hex fallback selectors

**Date:** 2026-04-21
**Type:** Fix / UI

## Summary

User reported dark mode was "working in some places, not in others." The Settings toggle added `html.dark` class and persisted `gapmap.pref.dark_mode` correctly, but `style.css` had no `html.dark { ... }` rule at all — so only tokens were inverting via OS-level heuristics while the 205 hardcoded `#FFFFFF`/`#1A1614`/`#ECE6DC` usages stayed light. Half-dark UI was the result.

## Changes

### `app-tauri/src/style.css`

Added a comprehensive `html.dark { ... }` block (69 scoped rules) right after `:root`:

- **Token overrides** — `--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-2`, plus darkened `-soft` variants for every accent (orange / lavender / mint / sky / rose / gold). Every component that uses `var(--surface)`, `var(--ink)`, etc. now flips automatically.
- **Inline-hex attribute selectors** — `[style*="background:#fff"]`, `[style*="background: #FFFFFF"]`, `[style*="background:#F8F4EC"]`, `[style*="background:#FBF8F2"]`, `[style*="color:#000"]`, `[style*="color:#1A1614"]`, `[style*="border:1px solid #ECE6DC"]`, etc. — catch inline styles scattered through screens without having to rewrite markup.
- **Form controls** — `input`, `textarea`, `select`, `::placeholder` explicit rules so native inputs don't stay white.
- **Nav active state** — the baked `#FFF4EA` background on `.nav a.active` flipped to `var(--orange-soft)` (which is itself darkened by the token override).
- **Scrollbars** — `::-webkit-scrollbar-track/thumb` use tokens.
- **`color-scheme: dark`** on body — native form controls + scrollbar shadows match OS dark mode.

### `app-tauri/src/screens/settings.js`

Toggle handler now emits `window 'gapmap:theme-changed'` event after flipping the class. Canvas-rendered screens (map, trend chart) read CSS vars via `getComputedStyle` at paint time — they cache those values, so a CSS-only flip leaves charts stuck on the old palette. Listening for this event triggers a re-render.

## Why the earlier `html.dark` class wired up but nothing changed

`main.js::applyEarlyPrefs` adds `html.dark` on boot from `localStorage['gapmap.pref.dark_mode']`. Settings toggle re-applies it on change. Both were correct. The CSS was the missing link — no `.dark` rule existed, so the class was essentially inert. Components inherited `prefers-color-scheme` defaults from the webview, which is why SOME components (browser-default buttons, native form widgets) looked dark-ish while most (surfaces, cards, sidebars using hex literals) stayed light.

## Verification

- `style.css` brace balance: 1354 `{` / 1354 `}` — clean.
- `node --check settings.js` → OK.
- 69 `html.dark` rules registered post-edit (was 0).
- Vite HMR picks up the CSS change without a restart.

## Files Modified

- `app-tauri/src/style.css` — dark-mode token overrides + inline-hex attribute selectors
- `app-tauri/src/screens/settings.js` — `gapmap:theme-changed` event emission
