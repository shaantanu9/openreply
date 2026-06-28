# Fix v0.1.7 release-blocker: missing lib/toast.js import in mergeModal

**Date:** 2026-05-31
**Type:** Fix

## Summary

The v0.1.7 release builds (mac/windows/linux) all failed at the Vite frontend build
step (`npm run build`, tauri `beforeBuildCommand`) with:

```
Could not resolve "../lib/toast.js" from "src/screens/mergeModal.js"
```

The topic-merge feature's `mergeModal.js` imported `showToast` from a shared
`src/lib/toast.js` module that was never created — the only existing `showToast` lived
locally (non-exported) inside `screens/topic.js`, and with an **incompatible signature**
(`showToast(title, detail, kind)` with kinds `err|warn|ok`, vs the
`showToast(message, kind)` with kinds `info|error|success` that `mergeModal.js` calls).
The Rust `cargo check` and the `ci` workflow passed because neither runs the Vite build,
so the break only surfaced in the release pipeline.

## Changes

- Created `app-tauri/src/lib/toast.js` — a self-contained shared toast module exporting
  `showToast(message, kind = 'info', ms = 5000)` matching `mergeModal.js`'s call sites.
  Maps friendly kinds (`info|success|error|warn` + aliases) to the app's existing
  `.toast-{err,warn,ok,success,info}` CSS classes and lucide icons, lazily creates the
  `.toast-stack` container, escapes content, and calls `window.refreshIcons?.()` so the
  injected lucide placeholder renders (consistent with the rest of the app).
- Added a `.toast-info` left-border rule to `style.css` (the only kind mergeModal used
  that lacked a style; `err/warn/ok/success` already existed).
- Verified locally: `npm run build` now completes (`✓ built` — only pre-existing benign
  dynamic/static dual-import advisory warnings remain, no errors).
- `screens/topic.js` left untouched — it keeps its own richer title+detail toast variant
  (zero regression risk to the working path).

## Files Created

- `app-tauri/src/lib/toast.js`
- `changelogs/2026-05-31_16_fix-mergemodal-toast-import-release-blocker.md`

## Files Modified

- `app-tauri/src/style.css` — added `.toast-info` border rule.

## Release

The failed `v0.1.7` builds produced no artifacts and no GitHub release object, so the
`v0.1.7` tag is moved to the fixed commit and re-pushed (clean re-release, no version
bump needed — all version pins were already 0.1.7).
