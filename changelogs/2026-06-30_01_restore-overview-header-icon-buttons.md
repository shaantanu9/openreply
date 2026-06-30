# Restore Overview header icon-only buttons (regressed to text by a merge)

**Date:** 2026-06-30
**Type:** Fix

## Summary

The Overview header's secondary actions (Refresh + learn, Evolve now, Suggest
ideas) had regressed from the intended **icon-only** buttons back to full
icon+text buttons (a later merge reverted the change from changelog
`2026-06-29_06`). Restored the compact 36px round icon buttons with hover
tooltips; only the primary **Find opportunities** CTA keeps its text label.

## Forensic note

The icon-only version (shared `btnIcon` class + `title`/`aria-label` tooltips +
bare-spinner loading states) was last present in commit `50a1409`; the current
working copy had the text version. This restores `50a1409`'s header markup and
loading states. Button IDs (`ov-refresh`/`ov-evolve`/`ov-suggest`) are unchanged
so all click handlers keep working.

## Changes

- `renderOverview`: added the `btnIcon` class; Refresh + learn / Evolve now /
  Suggest ideas are now icon-only round buttons (`refresh-cw`/`sparkles`/
  `lightbulb`) with descriptive tooltips; Find opportunities keeps its label.
- Loading states swap to a bare spinning `loader` icon (no text) so the label
  doesn't clip the 36px button.

## Files Modified

- `app-tauri/src/or/dynamic.js` — icon-only header buttons + spinner loading states.

## Verification

- `npm run build` (vite) → built, no JS errors.
