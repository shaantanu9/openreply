# Skeleton / loader overflow containment — keep loading states inside the box

**Date:** 2026-05-31
**Type:** Fix

## Summary

User reported some skeleton loaders rendering wider than their container
("the loading is going outside the box"). Root cause: the loader CSS grew
across several families and not all of them set width containment — the first
dashboard `.skel` definition and the legacy `.skeleton-card` lacked
`box-sizing`/`max-width`, and the `.sk-grid` / `.gm-az-grid` track minimums
(`280px` / `300px`) could exceed a narrow panel and push the grid past its
parent.

Added one defensive containment floor (appended last so it wins the cascade)
covering EVERY loading primitive: the new `.sk-*` builders, the legacy
`.skeleton*` + dashboard `.skel*` families, and the rich `.gm-az` analyzing
hero. Every skeleton now stays inside its box at any window width.

## Changes

- `box-sizing: border-box; max-width: 100%` on all `.skel*` / `.skeleton*`
  primitives.
- `.sk-grid/.sk-rows/.sk-stats/.sk-detail` → `width:100%; max-width:100%;
  min-width:0; box-sizing:border-box` so block wrappers take exactly the
  parent width.
- `.sk-card/.sk-row/.sk-stat` → `min-width:0; max-width:100%; overflow:hidden`.
- `.sk-grid` track min `280px → min(240px, 100%)`; `.gm-az-grid` →
  `min(260px, 100%)` — grids stay fluid and clamp to the container on narrow
  panels.
- `.gm-az` hero/grid/card/bar/stage/title → `max-width:100%; min-width:0;
  box-sizing:border-box`; long stage/title strings `overflow-wrap: anywhere`
  so text wraps instead of widening the hero.

## Files Modified

- `app-tauri/src/style.css` — appended the loader containment block.

## Verification

- `npm run build` (vite) → ✓ built.
- Visual confirmation pending in the running app (CSS-only change; no JS/markup
  touched).
