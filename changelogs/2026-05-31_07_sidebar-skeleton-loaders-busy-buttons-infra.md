# Sidebar loading UX: shared skeleton-loader + busy-button infra (+ reference wave)

**Date:** 2026-05-31
**Type:** UI Enhancement

## Summary

Sidebar pages showed a dead "loading…" / "running…" text line while fetching,
and action buttons gave no feedback on click. Introduced shared, reusable
loading primitives so every sidebar screen can show a layout-shaped skeleton on
open and a spinner/busy state on every Submit/Run/Generate/Collect button — with
a one-line change per screen. This commit lands the infrastructure plus a
reference wave on four representative screens (list, table, detail, search);
the remaining screens follow in subsequent waves using the same pattern.

Design follows the `loader-progress-ux` skill: skeleton screens for page loads
(option chosen by the user), and the rich `renderAnalyzingState` hero (already
in `analyzingLoader.js`) reserved for genuinely slow (5s+) actions via
`withRichLoader`.

## Changes

### New shared infra
- `src/lib/skeleton.js` — builders returning layout-shaped skeleton HTML on top
  of the existing `.skel` shimmer (no new keyframes):
  `skelGrid` (card grids), `skelRows` (lists/tables), `skelStats` (stat tiles),
  `skelDetail` (single panel), `skelInline` (tiny inline spinner).
- `src/lib/busyButton.js` —
  `withButtonBusy(btn, fn, {busyLabel})` swaps a button's label for a spinner +
  "Working…", disables it, restores on success/error (width-pinned to avoid
  layout jump); `withRichLoader(containerEl, fn, opts)` mounts the rich
  Analyzing hero for long actions and returns the result.
- `src/style.css` — `.sk-grid/.sk-card/.sk-row/.sk-rows/.sk-stats/.sk-detail/
  .sk-inline` layout wrappers + `.btn-spin` / `.btn.is-busy` inline spinner
  (reuses the `gm-az-spin` keyframe).

### Reference wave (4 screens)
- `reports.js` — skeleton rows for the file list, skeleton detail for the
  preview pane, busy state on Refresh.
- `tasks.js` — skeleton stat tiles + rows for the initial runtime snapshot,
  busy state on Refresh.
- `find.js` — skeleton rows while semantic search runs + model-status check,
  busy state on Search.
- `database.js` — skeleton rows for the table list and SQL query result, busy
  state on Run.

## Files Created
- `app-tauri/src/lib/skeleton.js`
- `app-tauri/src/lib/busyButton.js`

## Files Modified
- `app-tauri/src/style.css` — skeleton layout wrappers + button busy spinner.
- `app-tauri/src/screens/reports.js`, `tasks.js`, `find.js`, `database.js` —
  adopt skeletons + busy buttons.

## Verification
- `node --check` on all changed JS → OK.
- `npm run build` (vite) → ✓ built (warnings are pre-existing dynamic-import
  notices, not errors).

## Follow-up
Remaining sidebar screens (activity, collects, search, watch, ingest, audience,
personas, products, competitors, science, playbook, ost, empathy, interviews,
pmf, pricing, launch, improve, iterate, concepts, solutions, prd, insights,
trends, papers, …) get the same treatment in subsequent waves. `topic.js` and
`sentiment.js` are being actively edited by a parallel work-stream and are
deferred to avoid collisions.
