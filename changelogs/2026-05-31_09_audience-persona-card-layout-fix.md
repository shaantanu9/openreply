# Audience persona cards: fix one-word-per-line layout + title truncation

**Date:** 2026-05-31
**Type:** Fix (UI)

## Summary

With the sklearn clustering fix in place, the Audience tab now renders personas
— but the cards were visually broken: SAYS/WANTS/HATES text wrapped **one word
(sometimes one letter) per line**, and persona titles truncated to "Clust…".

Root cause: `.aud-quad-grid` is hard-coded to **3 columns** (`1fr 1fr 1fr`) and
only stacks below a **720px viewport** media query. But persona cards live in
`.topic-grid` (`auto-fit, minmax(260px,1fr)`), so each card is ~260px wide
regardless of viewport — making each of the 3 sub-columns ~70px. Sentence-length
quotes can't fit, so they wrapped catastrophically. The viewport media query
never triggered because the *window* was wide even though the *card* was narrow.

## Fix

In `screens/audience.js` (kept out of `style.css`, which an in-flight refactor
currently owns, to avoid a merge collision):

- **Quadrant grid** → `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`.
  Now keyed off the *card's* width: SAYS/WANTS/HATES stack full-width in a narrow
  card (readable sentences) and sit side-by-side only when the card is genuinely
  wide. No more one-word-per-line.
- **Persona grid** (`#aud-grid`) → wider min (`minmax(min(420px,100%),1fr)`) so a
  card has room for its title (no more "Clust…" truncation) and roomy
  side-by-side quadrants on large windows.

## Files Modified

- `app-tauri/src/screens/audience.js` — inline grid-template on the quadrant grid
  + persona grid (override the narrow `.topic-grid` / 3-col defaults).

## Verification

- `node --check` clean; `npm run build` succeeds.

## Notes

- These are inline grid-templates (a deliberate, temporary exception to the
  no-inline-style rule) purely to avoid editing the concurrently-refactored
  `style.css`. Fold them into `.aud-quad-grid` / an `#aud-grid` rule once that
  refactor lands.
- Separate, larger issue (NOT this fix): the personas show "(none extracted)"
  for SAYS/WANTS/HATES and are named "Cluster N" because the build ran in
  **offline mode** (no LLM augmentation). Getting "proper" personas needs the
  LLM pass ("Re-build with AI") — tracked separately.
