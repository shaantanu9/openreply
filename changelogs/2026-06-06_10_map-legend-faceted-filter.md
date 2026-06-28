# Map faceted filtering — clickable legend

**Date:** 2026-06-06
**Type:** Feature

## Summary

Closes the last functional cat-15 gap: the graph map ("Map" tab) now supports
faceted filtering. The legend in the generated graph viewer is now interactive —
clicking any node-kind swatch hides/shows that kind of node and its incident
edges, entirely client-side (no rebuild, no sidecar round-trip). This makes a
dense gap map readable: hide posts to see the painpoint↔product skeleton, or
isolate just painpoints + competitors.

Implemented by extending the viewer's existing `shouldShow`/visibility machinery
(`src/openreply/graph/export.py` `_HTML_TEMPLATE`) rather than adding new controls,
so it composes with the existing "Show users" toggle. `MAP_EXPORT_VERSION`
bumped 4→5 so existing cached maps auto-rebuild on next open and pick up the
clickable legend.

Verified: `export.py` parses; a real graph renders (3.3 MB HTML); the extracted
inline viewer script passes `node --check`; all new tokens present in output.

## Changes

- `export.py` `_HTML_TEMPLATE`: added a `hiddenKinds` Set + a single
  `applyVisibility()` helper; `shouldShow()` now also hides kinds in
  `hiddenKinds`; legend swatches are now clickable toggles (`.legend-item`,
  dimmed `.legend-off` state) that flip a kind and re-apply visibility; the
  `showUsers` handler + initial apply refactored to call `applyVisibility()`
  (de-duplicated).
- `topic.js`: `MAP_EXPORT_VERSION` 4 → 5 (auto-rebuild self-heal).

## Files Modified

- `src/openreply/graph/export.py`
- `app-tauri/src/screens/topic.js`

## Known gaps

- None functional. Tasks/Activity remain intentionally minimal but functional
  admin screens (runtime jobs queue + fetch log).
