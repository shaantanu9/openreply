# Post-Science tab screens — UI + flow fixes

**Date:** 2026-05-01
**Type:** Fix

## Summary

Every sidebar screen added after Science (Playbook, OST, Empathy, Interviews,
PMF, Pricing — plus Estimate / PRD reached from Product dashboards) shipped
with broken layout because four primitive style hooks were missing. Action
buttons collapsed into the breadcrumbs, breadcrumb back-links rendered in
default browser blue, the Pricing sub-tabs all rendered simultaneously
because `display: flex` on the class beat the `hidden` attribute, and the
OST outcome inline-editor had the same hidden-attribute override bug.
Single-file CSS pass — no JS changes — restores all six screens.

## Changes

- **Add `.topbar-actions` rule** — `margin-left: auto; display: flex; gap: 8px;
  align-items: center; flex-wrap: wrap; flex-shrink: 0`. Every detail screen
  that uses `<div class="topbar-actions">` (Empathy build button, Interviews
  "New interview", OST RICE/MoSCoW/Kano triggers, Estimate "Export PRD",
  PRD copy/download/regen) now gets its action cluster pushed to the right
  edge of the topbar instead of sitting next to the crumbs.
- **Style `.crumbs a` and `.crumbs` layout** — anchors in breadcrumbs (e.g.
  `<a href="#/empathy">Empathy maps</a> ›`) were rendering in the browser
  default link blue. Now use `var(--ink-2)` with a dashed underline on hover
  to match the rest of the chrome. Crumbs also become a `flex` row so the
  `›` separator and trailing topic title wrap cleanly on narrow widths.
- **Global `[hidden] { display: none !important }`** — both `.pricing-pane`
  and `.ost-outcome-edit` set `display: flex`, which silently overrode the
  HTML `hidden` attribute. Result on Pricing: all three instrument panes
  (Van Westendorp / NPS / MaxDiff) rendered at once. Result on OST: the
  outcome inline-edit form never collapsed back down. The single `!important`
  rule restores the spec-defined behavior of `el.hidden = true`.
- **Center the Playbook column** — `.pb-wrap` had `max-width: 1080px` but no
  `margin: 0 auto`, so on wide windows the entire phase ladder was pinned to
  the left edge. Now centered like every other wrapper.
- **`.ost-wrap` width clamp** — was un-bounded, so the Opportunity Solution
  Tree picker stretched edge-to-edge on a 27" monitor. Now `max-width: 1180px;
  margin: 0 auto` to match the visual rhythm of the sibling screens.

## Files Modified

- `app-tauri/src/style.css` — five rules added/edited near the top-level
  topbar block + the `.pricing-pane`, `.ost-outcome-edit`, `.pb-wrap`, and
  `.ost-wrap` blocks.
