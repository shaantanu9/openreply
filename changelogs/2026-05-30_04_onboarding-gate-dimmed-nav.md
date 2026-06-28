# Onboarding gate: dim + label locked sidebar nav

**Date:** 2026-05-30
**Type:** UI Enhancement

## Summary

On a fresh install the router (`mustStayInOnboarding`) bounces every non-welcome route back to `#/welcome` until onboarding completes. The sidebar nav looked live but every click silently snapped back — users reported "no sidebar buttons are clickable on a new install." Made the gate's effect visible: while onboarding is incomplete, the sidebar nav dims (opacity 0.4, pointer-events:none) with a "Finish setup to unlock" label, so the WHY is obvious. Gate behavior is unchanged; this is purely the missing affordance.

## Changes

- Added `syncOnboardingBodyFlag()` setting `body[data-onboarding="incomplete|complete"]`, called at the top of `route()` (covers every nav + boot). Clears automatically when onboarding completes (each `markOnboardingComplete()` is followed by a `#/` redirect → `route()`).
- CSS dims `body[data-onboarding="incomplete"] .sidebar .nav a` + adds an unlock hint after `#nav-workspace` (suppressed in rail mode).

## Files Modified

- `app-tauri/src/main.js` — `syncOnboardingBodyFlag()`, call in `route()`
- `app-tauri/src/style.css` — `body[data-onboarding="incomplete"]` rules
