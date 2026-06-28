# Sidebar & agent dropdown — padding/border polish + native-select fix

**Date:** 2026-06-27
**Type:** UI Enhancement

## Summary

Fixed the sidebar's agent dropdown rendering and tidied the outer padding/borders.
The "Active agent" control was a raw native `<select>`, which in macOS WKWebView
draws the OS select chrome (bevel/border) inside the custom card — the "border
not proper" the user reported. Replaced it with a properly styled select:
`appearance:none` + a single custom `chevron-down` caret, with an overflow-clip
so Chrome 148's stubborn native arrow is also hidden (Chrome no longer drops the
arrow on `appearance:none`). Verified in-browser that exactly one caret renders
and the select stays fully functional/clickable.

## Changes

- `shell.js` agent dropdown: `appearance:none` (all vendor prefixes, inline) +
  custom `chevron-down` icon; wrapper `overflow-hidden` + select
  `width:calc(100% + 26px)` to clip the residual Chrome native arrow; box padding
  `px-3 py-2`, select `pr-6` so text clears the caret.
- Consistent, more-visible card borders in dark mode (`dark:border-zinc-700/70`)
  across the agent box, search input, and theme toggle.
- Logo alignment: `px-1.5 pb-1` to line up with the section headers.

## Files Modified

- `app-tauri/src/or/shell.js` — agent dropdown styling, card borders, logo padding

## Verification

- Rendered at `localhost:1420` (vite): single clean chevron, no native double-arrow
  (confirmed via DOM — `appearance:none`, 1 SVG icon, native arrow clipped).
- Diagnosed the two-arrow symptom to Chrome 148's customizable-select behavior;
  WKWebView (the app's engine) removes the native arrow via `appearance:none`.
- Select remains a real native control (keyboard/accessibility intact); 42px
  click target; `onchange` switching unaffected.
- `node --check app-tauri/src/or/shell.js` passes. Pure frontend — hot-reloads
  in the running app, no Rust rebuild needed.
