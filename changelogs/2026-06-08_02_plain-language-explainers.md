# Lever 1 — plain-language explainers for every page

**Date:** 2026-06-08
**Type:** UX Enhancement

## Summary

First lever of the "make the app understandable for non-technical beta users" effort.
Every page's help now leads with plain English: a one-jargon-free-sentence **"In plain
English"** and a **"What to do here"** step list — instead of academic prose ("Denzin
1978", "triangulation", "JTBD"). Added `simple` + `do` fields to the explainer registry,
rewrote/covered 43 screens (was 41, added research-home/audience/write/library/reader/
help), and — critically — fixed the seeder so improvements REACH EXISTING INSTALLS
(previously it only inserted missing rows and never refreshed). User-edited rows are
still preserved.

## Changes

- `runtime/explanations.py`: added `simple` (plain one-liner) + `do` (what-to-do steps)
  to every entry; added 6 previously-uncovered core screens; new schema columns
  (`simple`, `do_json`) with auto-migration for existing tables; replaced
  `_seed_if_missing` with `_seed_and_refresh` (inserts missing AND refreshes
  non-user-touched rows to latest seed text); `get_explanation`/`list_explanations`/
  `set_explanation` now carry the new fields.
- `lib/helpPopover.js`: eye-icon popover now leads with the plain sentence + a numbered
  "What to do here" list; academic detail demoted to "More detail".
- `screens/why.js`: full explainer page leads with the plain sentence + what-to-do block.
- `screens/help.js`: hub index uses the plain `simple` blurb.
- `style.css`: styles for the what-to-do lists (popover + why page).

## Files Modified

- `src/openreply/runtime/explanations.py`
- `app-tauri/src/lib/helpPopover.js`, `screens/why.js`, `screens/help.js`, `style.css`

## Verification

- `py_compile` clean; `get_explanation('collect')` returns plain `simple` + `do`;
  refresh updated an existing seeded row (title → "Collect data"); 43 explainers total.
- `node --check` clean on all edited JS; `npm run build` succeeded; live dev server
  confirmed serving the new bundle.

## Next

Lever 2 — Simple Mode + grouped navigation (collapse ~70 nav items into ~8 plain
essentials with an Advanced section). Lever 3 — rename remaining jargon labels.
