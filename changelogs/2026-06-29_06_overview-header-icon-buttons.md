# Overview header: collapse secondary actions to icon-only buttons with tooltips

**Date:** 2026-06-29
**Type:** UI Enhancement

## Summary

The agent Overview header had five full text buttons (Refresh + learn, Evolve
now, Suggest ideas, Find opportunities, Delete agent), which crowded the heading.
The three secondary actions and Delete are now compact **icon-only** buttons with
**hover tooltips** (native `title` + `aria-label` for accessibility). Only the
primary CTA, **Find opportunities**, keeps its label. Same look, far less clutter.

## Changes

- `renderOverview` header: Refresh + learn / Evolve now / Suggest ideas → 36px
  round icon buttons (`refresh-cw` / `sparkles` / `lightbulb`) using a shared
  `btnIcon` class; Delete agent → round rose icon button (`trash-2`). Each carries
  a descriptive `title` tooltip and an `aria-label`. Button IDs unchanged, so all
  existing click handlers keep working.
- Loading states fit the square buttons: the three actions now swap to a bare
  spinning `loader` icon instead of writing text (which would clip a 36px button).

## Files Modified

- `app-tauri/src/or/dynamic.js` — icon-only header buttons + tooltips; spinner
  loading states for refresh/evolve/suggest.
