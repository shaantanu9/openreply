# Persona screen — button styling + whole-card click

**Date:** 2026-05-12
**Type:** UI Enhancement

## Summary

The Persona agents list screen rendered its action buttons as unstyled inline text because `personas.js` was using `class="btn-primary"` and `class="btn-ghost-bordered"` — neither of which carries the base `.btn` rules (padding, border-radius, font weight), and `btn-ghost-bordered` is not defined in `style.css` at all. The card itself had `cursor:pointer` but no whole-card click handler, so clicking anywhere outside the (mis-rendered) buttons did nothing. This pass fixes both — buttons now use the canonical `btn btn-primary btn-sm` / `btn btn-ghost btn-bordered btn-sm` pattern that the rest of the app uses, and the entire persona card is clickable (navigates to `#/persona/:id`) with per-button actions stopping propagation so they don't double-trigger.

## Changes

- Replaced every `class="btn-primary"` with `class="btn btn-primary btn-sm"` in `personas.js` (list-screen Create button + Open card button + Chat Ask + Conclusions Synthesise + Ingest Run).
- Replaced every `class="btn-ghost-bordered"` with `class="btn btn-ghost btn-bordered btn-sm"` (Pause/Resume/Delete card buttons + Memories Refresh + Graph Refresh/Backfill + Conclusions Refresh).
- Made the persona card itself clickable: card click → `#/persona/:id`, button clicks stop propagation. Per-button delegation moved from a single card-level listener to one listener per `[data-act]` button so the card-level handler can fire on the "click outside any button" case.
- Added an explicit `data-active="1|0"` on the card root so the toggle handler doesn't have to guess at boolean coercion of `p.active` (which may be `1`/`0`, `true`/`false`, or a string).
- Replaced the unstyled `<label class="switch">` auto-ingest toggle with a real 38×22 pill switch (custom `.persona-switch` pattern with hidden native checkbox + sliding thumb + brand-purple checked state + focus ring).
- Redesigned the "Create a new persona" form: 2-column responsive grid for Name + Lens, full-width Goal and System-prompt textareas, single row for Color/Icon/Create button. Field inputs now use the app's surface variables, brand-purple focus ring (`0 0 0 3px rgba(124,58,237,.15)`), and a consistent 10px border radius.
- Added a chevron indicator on the right of each persona card header to reinforce the "click to open" affordance, plus a subtle 2px hover lift + shadow on `.persona-card:hover`.
- Added lucide icons to all action buttons (folder-open, pause/play, trash-2, rotate-ccw, layers, send, sparkles, plus, play, zap) so they read clearly at the `btn-sm` size.
- The Delete button is now icon-only with a tooltip + tinted red border (`.persona-delete-btn`) — saves space and matches destructive-action conventions.

## Files Modified

- `app-tauri/src/screens/personas.js` — list-screen `renderPersonas` + `personaCard` + `reloadList` click wiring, plus tab subscreens (`mountMemoriesTab`, `mountChatTab`, `mountGraphTab`, `mountConclusionsTab`, `mountIngestTab`) button classes.
- `app-tauri/src/style.css` — appended `.persona-card` hover/active styles, `.persona-delete-btn` tint, `.persona-switch` custom toggle (track + thumb + checked/focus states), and `.np-form .np-field` form-field styling (input/textarea base + focus ring + color-picker dimensions).
