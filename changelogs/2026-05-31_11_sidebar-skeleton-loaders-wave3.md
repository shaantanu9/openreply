# Sidebar loading UX — wave 3 (skeletons + busy buttons across remaining screens)

**Date:** 2026-05-31
**Type:** UI Enhancement

## Summary

Third and final rollout wave of the shared skeleton-loader + busy-button infra
(`2026-05-31_07`). Covered the remaining + large sidebar screens via parallel
sub-agents over disjoint file sets. Dead `loading…`/`running…` placeholders →
layout-shaped skeletons; async action buttons → inline spinner busy states.
Existing rich `renderAnalyzingState` loaders and custom streaming/progress
loaders were detected and left intact.

Also includes visual verification of the overflow-containment fix
(`2026-05-31_10`): rendered every skeleton variant in deliberately narrow
(200–320px) boxes via headless Chrome and measured each child's right edge vs
its container — all 6 variants reported zero overflow.

## Changes (per screen)

- `audience.js` — personas grid → `skelGrid(6)`, picker → `skelRows(4)`; existing
  build-shell polling loader left intact.
- `global_competitors.js` — competitor grid → `skelGrid(6)`; Refresh busy-wrapped.
- `compare.js` — two side-by-side report panels → `skelDetail` ×2.
- `trends.js` — 30–90s temporal-gaps LLM call now runs through `withRichLoader`
  (spinner + elapsed + stages) with a shared `runKey` so elapsed survives tab
  flips, replacing the dead "Running… 30–90 seconds" text.
- `posts.js` — cold list load → `skelRows(8)` (SWR fast path untouched).
- `why.js` — index + single explainer → `skelDetail`.
- `bets.js` — first-paint → `skelGrid(4)`; existing inline button busy left.
- `estimate.js` — form shell → `skelDetail`; Save busy-wrapped.
- `intent_ladder.js` — coverage host → `skelGrid(2)`.
- `science.js` — live row-counts grid → `skelGrid(6,{lines:2})`.
- `personas.js` — list/memories/conclusions/rejections → `skelGrid`/`skelRows`;
  Create + 3 Refresh buttons busy-wrapped; existing NDJSON streaming loaders
  (scan/teach/ingest/synthesise) left intact.
- `product.js` — dashboard sections → `skelStats`/`skelRows`/`skelGrid`, strategy
  sub-panels → `skelInline`; Sweep/Digest/Register/Convert/3×Save busy-wrapped.
- `insights.js` — initial page-load → `skelDetail`; Export menu items busy-wrapped;
  existing rich synthesis loader (3 call sites) left intact.
- `home.js` — dashboard momentum/activity + topics grid → skeletons on the
  no-cache path (SWR cache path untouched).
- `settings.js` — Table-counts card → `skelRows(4)` (conservative; section-grouping
  + MCP card untouched; cards with their own busy state left alone).

## Files Modified

- `app-tauri/src/screens/`: audience.js, global_competitors.js, compare.js,
  trends.js, posts.js, why.js, bets.js, estimate.js, intent_ladder.js,
  science.js, personas.js, product.js, insights.js, home.js, settings.js

## Verification

- `node --check` on every changed file → OK (15/15).
- `npm run build` (vite) → ✓ built.
- Headless-Chrome overflow probe across all skeleton variants in 200–320px
  boxes → 0 overflow on all 6 variants.

## Status

Sidebar loading-UX rollout is now complete across the workspace. `topic.js` and
`sentiment.js` were intentionally deferred throughout (active parallel
work-stream) and can adopt the same shared primitives later.
