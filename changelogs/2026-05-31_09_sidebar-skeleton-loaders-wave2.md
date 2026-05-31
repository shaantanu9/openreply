# Sidebar loading UX — wave 2 (skeletons + busy buttons across more screens)

**Date:** 2026-05-31
**Type:** UI Enhancement

## Summary

Second rollout wave of the shared skeleton-loader + busy-button infra (see
`2026-05-31_07`). Replaced dead `loading…`/`running…` text placeholders with
layout-shaped skeletons and added inline spinner/busy states to action buttons
across another batch of sidebar screens. Dispatched as parallel sub-agents over
disjoint file sets; existing rich `renderAnalyzingState` loaders were left
intact wherever present. (launch/improve/iterate are documented separately in
`2026-05-31_08`.)

## Changes (per screen)

- `activity.js` — spark card → `skelStats(1)`, table → `skelRows(8)`, in-flight
  pager load → `skelRows(8)`; Refresh button wrapped with `withButtonBusy`.
- `collects.js` — Running/Queue/This-session panes → `skelRows`. Start button
  left as-is (already has explicit busy handling).
- `search.js` — Search button wrapped with `withButtonBusy`; existing
  map-building spinner left intact.
- `papers.js` — list → `skelRows(8)`; 4 bibliography export buttons wrapped with
  `withButtonBusy`. "Find papers" left (already streams progress).
- `ingest.js` — single-file and bulk-CSV submit buttons wrapped with
  `withButtonBusy`.
- `pmf.js` — load state → `skelStats(4)`+`skelRows(5)`, picker → `skelRows(4)`,
  Add button busy-wrapped.
- `pricing.js` — load state → `skelStats(4)`+`skelRows(4)`, picker → `skelRows`,
  three Add buttons busy-wrapped.
- `ost.js` — load state → `skelStats(1)`+`skelGrid`, picker → `skelRows`;
  existing Re-run busy states left intact.
- `concepts.js` — no-cache fetch path → `skelGrid(6)` (rich generate loader
  untouched).
- `solutions.js` — no-cache fetch path → `skelGrid(6)` (rich generate loader
  untouched).
- `empathy.js` — map load → `skelGrid(4,{lines:4})`, picker mount → `skelRows(4)`
  (rich build loader untouched).

No change needed (reported by agents, verified): `watch.js` (genuine active/idle
stream states, Start→Stop affordance), `ingest_video.js` (live streaming
progress), `playbook.js` (fully static), `prd.js` (only the rich generate loader,
no dead placeholder).

## Files Modified

- `app-tauri/src/screens/`: activity.js, collects.js, search.js, papers.js,
  ingest.js, pmf.js, pricing.js, ost.js, concepts.js, solutions.js, empathy.js

## Verification

- `node --check` on every changed file → OK.
- `npm run build` (vite) → ✓ built.

## Follow-up (wave 3)

Remaining/large screens still to do: audience, personas, product(s),
global_competitors, insights, science, home, trends, posts, why, bets, estimate,
compare, intent_ladder, settings. `topic.js` / `sentiment.js` deferred (active
parallel work-stream).
