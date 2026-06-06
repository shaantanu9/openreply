# OST Impact×Effort matrix + Global-Competitors enriched cards

**Date:** 2026-06-06
**Type:** UI Enhancement

## Summary

Closes two of the three remaining cat-15 viz gaps (the third, Insights
consensus tiers, shipped in `2026-06-06_06`). The OST screen gains a proper
Impact×Effort 2×2 prioritisation matrix, and the Global-Competitors cards
surface the real per-competitor signal that was previously hidden. With these,
FEATURES.md category 15 goes to 22/25 and the project tracker reads
**196 · 193 ✅ · 3 🟡** — the only 🟡 left are cosmetic (Map/Graph faceted
filtering, Personas polish, Bets/Tasks/Activity UI), all functional.

Build-verified: node --check on all three changed screens passes; vite builds
1800 modules.

## Changes

- **OST 2×2 matrix (`ost.js`):** new `collectScoredInterventions()`, `normRange()`,
  `renderImpactEffortMatrix()`; injected above the opportunity tree. Each
  RICE-scored intervention is plotted as a CSS-positioned dot by `rice.impact`
  (y) × `rice.effort` (x), normalised over the tree's range, into four labelled
  quadrants (Quick wins / Big bets / Fill-ins / Money pit). Quick-wins quadrant
  is green; hover shows label + RICE + reach/impact/effort/confidence + the
  painpoint addressed. Empty state reuses the existing Compute-RICE CTA. No chart
  library. Tree / RICE-MoSCoW-Kano reruns / experiment flows untouched.
- **Global-Competitors detail (`global_competitors.js`):** topics rendered as
  escaped chips, a dataset-relative cross-topic reach bar (topics vs the set's
  max), a derived mentions-per-topic figure, and richer section headers (topic
  count, alias count, total mentions). Only real fields used (`canonical_name`,
  `aliases`, `topics`, `total_mentions`) — no invented data; the response has no
  URL field so none was added.

## Files Modified

- `app-tauri/src/screens/ost.js`
- `app-tauri/src/screens/global_competitors.js`
- `FEATURES.md` — cat 15 → 22/25, Total 196 · 193 ✅ · 3 🟡.
- `docs/BUILD-PROGRESS.md`

## Known gaps

- 3 cosmetic cat-15 screens remain (functional, basic UI): Map/Graph faceted
  filtering, Personas polish, Bets/Tasks/Activity UI. P2.
