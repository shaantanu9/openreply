# Fix app-wide scroll — main content area couldn't scroll past the viewport

**Date:** 2026-06-29
**Type:** Fix

## Summary

The whole app couldn't scroll when a view was taller than the viewport. The
single scroll container `#main-content` ships with `overflow-auto` in
`index.html`, but every view (≈24 renderers in `dynamic.js`, 17 static `v.main`
strings in `views.js`, and the `main.js:56` default) re-sets `view.className` to
`"w-full max-w-6xl flex-1 px-8 py-7"` — which carries no overflow utility. Inside
the `flex h-screen overflow-hidden` shell, that wiped `overflow-auto` on first
render and clipped any tall view with no scrollbar. The taller Daily Update card
surfaced the long-standing bug on Overview.

## Changes

- Pinned the scroll behaviour on the id in `styles.css`:
  `#main-content { overflow-y: auto; overflow-x: hidden; min-height: 0; }`.
  Since no className ever sets an overflow utility, the id rule always wins —
  fixing scrolling for **all** views in one place (no need to edit 40+ className
  strings). `min-height: 0` lets the flex child shrink so overflow engages.

## Files Modified

- `app-tauri/src/styles.css` — added the `#main-content` scroll rule (top of file).

## Verification

- `npm run build` (vite) → built; rule confirmed present in
  `dist/assets/main-*.css`.
- Daily Update's own `max-h-[420px]` internal feed scroll is independent and
  unaffected.
