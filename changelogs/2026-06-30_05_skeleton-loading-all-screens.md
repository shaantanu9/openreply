# Skeleton loading across all app screens (centralized)

**Date:** 2026-06-30
**Type:** UI Enhancement

## Summary

Every data-driven screen in the Tauri app used to flash a bare `Loading…` text
string while its sub-regions fetched data — even though a shared skeleton
utility (`src/or/skeleton.js`) already existed and was used by the router on
navigation. Each `DYN[key]()` render function then immediately overwrote that
nice full-page skeleton with its real layout containing plain-text `Loading…`
placeholders, so the perceived-performance win was lost the moment a screen
mounted. This change routes every content-region loading state through the
shared skeleton utility so loading looks consistent app-wide and never shows a
bare text placeholder or causes layout shift.

## Changes

- Extended `skeleton.js` with reusable, exported inner-region helpers so screens
  don't hand-roll their own pulse markup:
  - `skelCardBody(lines)` — card body only (drop inside an existing `${card}`)
  - `skelCard(lines)` — refactored to reuse `skelCardBody`
  - `skelCardsN(n, lines)` — N standalone cards for a `grid`/`space-y` container
  - `skelRows(n)` — compact text-line rows for small in-card lists
  - exported `skelKpiRow(n)` (was internal) for KPI-heavy screens
- Deleted the duplicate local `skeleton()` helper in `dynamic.js`; it now
  delegates to `skelCardsN()` so list screens (opportunities, inbox, queue,
  library) share one look.
- Replaced bare `Loading…` content placeholders with the shared skeletons on:
  Overview (initial + top-opportunities/recent-drafts/personas), Agents grid,
  Connections grid, Settings (all 11 cards), Knowledge (initial + graph),
  Analytics (KPI + chart), Queue (initial + refresh), Keywords, Brain, Alerts,
  AI Visibility (geo), Library, X Account (accounts list, timeline output),
  Tasks, and the inline draft/trend regions.
- Left genuine status-line text, `<select><option>Loading…</option>`, and
  sub-second user-triggered expands as plain text (correct per UI-state
  guidance — skeletons are for content regions, not status indicators).
- Verified with `vite build` (clean) and confirmed the one new Tailwind class
  (`space-y-2.5`) is emitted into the bundled CSS.

## Files Created

- `changelogs/2026-06-30_05_skeleton-loading-all-screens.md`

## Files Modified

- `app-tauri/src/or/skeleton.js` — added `skelCardBody`, `skelCardsN`,
  `skelRows`; refactored `skelCard`; exported `skelKpiRow`.
- `app-tauri/src/or/dynamic.js` — imported the shared helpers, removed the
  duplicate local `skeleton()`, and converted ~20 bare `Loading…` placeholders
  across 15+ screens to centralized skeletons.
