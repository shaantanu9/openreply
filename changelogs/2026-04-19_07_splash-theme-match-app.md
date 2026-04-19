# Splash screen theme matched to app

**Date:** 2026-04-19
**Type:** UI Enhancement

## Summary

The splash window used a dark purple gradient that clashed with the app's soft-dashboard cream/orange theme. Replaced the splash styling to mirror the main app palette: cream background (`#F6F3EE`), orange gradient brand mark, warm ink text, and an orange sweep progress bar.

## Changes

- Swapped dark gradient (`#0f1220 → #222540`) for app cream background (`#F6F3EE`) with `#ECE6DC` border
- Brand mark gradient changed from indigo (`#7c5cff → #4f46e5`) to app orange (`#FF8C42 → #FFA563`) with matching shadow
- Text color switched from `#e7e8f3` to ink (`#1A1614`) and ink-3 (`#8A8278`) for the subtitle
- Progress bar track darkened to `#ECE6DC`, sweep recolored to `#FF8C42`
- Loaded Plus Jakarta Sans to match the main app's font-family stack
- Reduced mark size (72→56px) and corner radius (14→18px) to align with app brand-mark dimensions

## Files Modified

- `app-tauri/splash.html` — full style rewrite to match the app's design tokens
