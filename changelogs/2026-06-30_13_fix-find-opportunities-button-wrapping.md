# Fix "Find opportunities" CTA wrapping / misaligned header buttons

**Date:** 2026-06-30
**Type:** UI Enhancement

## Summary

On the agent overview header, the primary "Find opportunities" button wrapped
its label onto two lines and the icon sat misaligned when the agent had a long
"watching …" platform list. Two root causes: the shared button classes had no
`whitespace-nowrap` (so labels could break), and the `head()` actions container
wasn't `shrink-0` (so a long subtitle squeezed the CTA group narrow).

## Changes

- `btnP` / `btn` shared button classes now use
  `inline-flex items-center justify-center gap-1.5 whitespace-nowrap` — icon and
  label render on one centered line, and labels never wrap. This fixes icon+text
  alignment consistently across every primary/secondary button in the app
  (previously each relied on per-icon `align-[-2px]` hacks).
- `head()` actions container changed to
  `flex shrink-0 flex-wrap items-center justify-end gap-2` so the header CTA
  group keeps its width and stays right-aligned even with a long subtitle.
- Verified the three `w-full` buttons still span full width with centered
  content under `inline-flex` (improved, not broken).

## Files Modified

- `app-tauri/src/or/dynamic.js` — `btn`, `btnP`, and `head()` helper.
