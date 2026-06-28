# Personas card enrichment + Bets screen polish

**Date:** 2026-06-06
**Type:** UI Enhancement

## Summary

Two of the three remaining cat-15 cosmetic gaps, done safely (one file each, no
data-layer changes, existing flows preserved, node-check green).

## Changes

- **Personas (`personas.js`):** `personaCard` now shows the persona's real
  learning state — a memory-count chip plus conditional conclusions / topics /
  edges chips (only rendered when the field exists in `p.stats` from
  `api.personaList()`), an active/paused status pill, lens + goal, and a
  lazy-loaded latest-lesson preview (highest-importance of the 5 newest via
  `api.personaMemories`, fetched after the grid paints with a 4-worker
  concurrency cap so it never blocks render). No invented fields; absent data
  is omitted. Border/icon colors hardened through `safeHexColor()`.
- **Bets (`bets.js`):** added a colored per-status summary strip
  (draft/running/validated/invalidated/paused) derived from loaded rows, a
  defensive `card_json` parser with a clearer bet statement + dates, a one-line
  resolution-notes preview per card, and an improved empty state explaining the
  "Save as bet" promotion flow with a CTA to Insights. Existing status-change +
  add-note controls and exports (`loadBets`, `saveBetFromCard`) unchanged.

## Files Modified

- `app-tauri/src/screens/personas.js`
- `app-tauri/src/screens/bets.js`

## Known gaps

- Tasks/Activity remain functional admin/debug screens (no real gap). The Map
  faceted-filter is handled separately (clickable legend in the graph viewer).
