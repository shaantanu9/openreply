# Fix TDZ error on collect screen refresh (`Cannot access 'stillHere' before initialization`)

**Date:** 2026-04-24
**Type:** Fix

## Summary

On cmd+R while on a collect screen, the app crashed with `Cannot access 'stillHere' before initialization`. The root cause was a temporal-dead-zone (TDZ) reference: `showRetryAction()` (defined mid-`renderCollect`) calls `stillHere()`, but `stillHere` was declared with `const` much later in the same function. When `api.startCollect()` rejected on refresh (e.g. sidecar not ready yet), the catch block invoked `showRetryAction()` before the `const` had been reached, throwing.

## Changes

- Hoisted the `myRouteGen` / `stillHere` declarations to the top of `renderCollect` in `src/screens/collect.js` so every handler defined later in the function can safely call `stillHere()`. The router already populates `root.dataset.routeGen` before dispatching the screen, so hoisting is safe.
- Replaced the original mid-function declaration with a comment pointing to the new location.

## Files Modified

- `app-tauri/src/screens/collect.js` — moved `myRouteGen` / `stillHere` declarations from line ~703 to the top of `renderCollect` (just after `topic` / `slug`); updated the explanatory comment at the old location.
