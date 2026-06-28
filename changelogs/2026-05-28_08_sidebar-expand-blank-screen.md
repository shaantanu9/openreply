# Fix blank main area when expanding sidebar from hidden

**Date:** 2026-05-28  
**Type:** Bug fix

## Summary

Minimizing the sidebar to **hidden** then expanding again (toggle, ⌘B, or reveal strip) could leave the entire main column at 0 width — a blank screen until the window was resized.

## Root cause

Hidden state used `grid-template-columns: 0 1fr` while the sidebar had `display: none`. In CSS Grid, `display: none` removes the sidebar from the grid, so only `.main-col` remained. Auto-placement put it in the **first** track (0px), not the `1fr` track.

## Fix

- Hidden state: single track `minmax(0, 1fr)`; `.main-col` explicitly `grid-column: 1`.
- Full / rail: explicit `grid-column: 2` on `.main-col`, `grid-column: 1` on `.sidebar`.
- Base `.app` uses `minmax(0, 1fr)` for the main track to avoid flex/grid overflow blow-out.

## Files modified

- `app-tauri/src/style.css`
- `app-tauri/src/main.js` — removed `display: none` toggle hack on `.app` (no longer needed)
