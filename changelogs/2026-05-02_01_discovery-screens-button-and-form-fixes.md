# Discovery-screens UI fixes — buttons, row helper, form inputs, icon sizes

**Date:** 2026-05-02
**Type:** Fix

## Summary

The OST screen and every screen below it in the sidebar (Empathy Maps,
Interviews, PMF Survey, Pricing Surveys, plus PRD and Estimate) looked
broken: primary buttons rendered as plain unstyled rectangles, picker
rows had no layout, lucide icons inside buttons were oversized, and raw
`<label><input/></label>` inputs inside cards had no styling. Root cause:
the screens were written with `class="btn primary"` (space-separated
modifiers) but the CSS only defined `.btn-primary` (hyphenated). The
shared `.row` flex helper was also referenced but never defined.

This change adds the missing CSS so the discovery screens render with
the same visual language as the rest of the app, without touching any
screen JS — the fix is centralised in `style.css`.

## Changes

- Added `.btn.primary`, `.btn.ghost`, `.btn.danger` (and `button.*`
  fallbacks) as space-separated aliases of the existing `.btn-primary`
  / `.btn-ghost` / `.btn-danger` classes. Same palette and hover state.
- Added a default surface for `.btn` with no modifier so plain `.btn`
  buttons (OST toolbar, modal Cancels, etc.) no longer render as
  transparent rectangles.
- Added `.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }`
  used by every picker form on the discovery screens.
- Added `.btn > svg { width: 14px; height: 14px; flex-shrink: 0; }`
  so lucide icons inside any `.btn` cap at 14px instead of the lucide
  default 24×24 — fixes oversized icons in the OST topbar and the
  Empathy "Build / refresh" button.
- Added scoped form-input styling for `.ost-wrap`, `.empathy-wrap`,
  `.iv-wrap`, `.pmf-wrap`, `.pricing-wrap`, `.estimate-wrap`,
  `.prd-wrap` so raw `<label><input/></label>` pairs inside `.card`
  pick up the app's input chrome (border, radius, focus ring).
- Added picker-row select / input sizing so the topic-picker on every
  discovery screen has a properly proportioned `<select>` next to the
  "Open →" button.
- Polished a few smaller items: PMF number inputs, pricing tab strip
  spacing, empathy quadrant grid breakpoint, OST modal z-index above
  the collect-status bar, PRD raw-pane background.

## Files Modified

- `app-tauri/src/style.css` — four blocks:
  1. Space-separated `.btn` modifier aliases + default `.btn` surface
  2. `.row` flex helper
  3. `.btn > svg` icon size cap
  4. "Discovery-screen polish" section appended at end of file
