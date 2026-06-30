# Website icons & favicon now use the app icon

**Date:** 2026-06-30
**Type:** UI Enhancement

## Summary

The Tauri webview UI previously used plain orange dots (`bg-reddit` circles) as
the brand mark and had no favicon, while the splash window showed a CSS-drawn
"O" gradient letter. None of these matched the actual app bundle icon (the
orange robot/chat mark in `src-tauri/icons/icon.png`). This change points every
in-app brand mark and the favicon at that same app icon so the website branding
matches the dock/Finder icon.

## Changes

- Copied the app icon to `public/icon.png` so Vite serves it at `/icon.png`
  (dev + build) and bundles it into `dist/` (verified `dist/icon.png` emitted).
- Added `<link rel="icon" type="image/png" href="/icon.png">` to `index.html`
  and `splash.html` (favicon).
- Replaced the sidebar brand dot (`shell.js` `sidebarHTML`) with an `<img>` of
  the app icon.
- Replaced the onboarding brand-bar dot (`dynamic.js` `brandBar`) with the
  app icon.
- Replaced the splash-screen CSS "O" gradient mark with the app icon image and
  simplified the `.mark` style (dropped the gradient/letter styling, kept the
  rounded shape + drop shadow).

## Files Created

- `app-tauri/public/icon.png` — app icon served at `/icon.png` for favicon + UI.

## Files Modified

- `app-tauri/index.html` — added favicon link.
- `app-tauri/splash.html` — added favicon link; swapped CSS "O" mark for the
  icon image; simplified `.mark` CSS.
- `app-tauri/src/or/shell.js` — sidebar brand dot → app icon `<img>`.
- `app-tauri/src/or/dynamic.js` — onboarding brand-bar dot → app icon `<img>`.
