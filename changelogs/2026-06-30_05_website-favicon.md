# Marketing website favicon set to the app icon

**Date:** 2026-06-30
**Type:** UI Enhancement

## Summary

The static marketing/site pages under `website/` had no favicon on any page, so
browsers showed a blank/default tab icon. Added the OpenReply robot app icon as
the favicon (and apple-touch-icon) across every HTML page so the browser tab and
home-screen bookmark match the app brand. The site is a static Vercel deploy with
`outputDirectory: "."`, so the icon is served at `/icon.png`.

## Changes

- Copied the app bundle icon (`app-tauri/src-tauri/icons/icon.png`) to
  `website/icon.png` (clean transparent PNG, same robot mark as the existing
  `openreply_icon.jpg`).
- Added `<link rel="icon" type="image/png" href="/icon.png">` and
  `<link rel="apple-touch-icon" href="/icon.png">` after the `<title>` of every
  page.

## Files Created

- `website/icon.png` — favicon asset served at `/icon.png`.

## Files Modified

- `website/index.html`
- `website/activate.html`
- `website/license.html`
- `website/privacy.html`
- `website/sign-in.html`
- `website/sitemap.html`
- `website/terms.html`
