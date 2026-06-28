# Map viewer — merge Insights + Lenses into a single left accordion panel

**Date:** 2026-06-02
**Type:** UI Enhancement

## Summary

Reworked the exported OpenReply graph viewer (`export.py`) from a fixed 3-column
layout (left findings · graph · right lenses/details) into a **2-column layout**:
a single left panel with a collapsible accordion (📊 Insights · ⚡ Lenses · 🔎
Selection) and the graph filling the rest. This frees the entire right edge of
the map for the upcoming chat sidebar overlay, and matches the approved
`docs/design/chat-variants/v2-focus-canvas.html` prototype.

## Changes

- `main` grid changed from `360px 1fr 320px` → `360px 1fr` (right column removed).
- Added accordion CSS (`.acc-head`, `.acc-body`, `.collapsed`, caret rotation).
- Left `<aside>` now hosts three accordion sections:
  - **📊 Insights** — exec summary, legend, top insights by source, painpoints,
    workarounds, products, feature wishes (all prior left-panel content).
  - **⚡ Lenses** — Reset zoom / Show users controls + the graphify lens buttons
    (Surprising, Gaps, Bridges, All edges, Communities) + search, moved from the
    old right panel.
  - **🔎 Selection** — the node-detail panel (`#details`), collapsed by default;
    auto-expands when a finding/node is clicked (added to `showNodeDetails`).
- Removed the `<aside class="right">` element entirely.
- Added accordion toggle wiring at the end of the viewer script.
- All element IDs (`#painpoints`, `#lenses`, `#details`, `#resetZoom`,
  `#showUsers`, `#graphSearch`, lens button IDs) are unchanged, so existing D3 /
  lens / details JS wiring keeps working — verified by headless render (no JS
  errors; accordion expand/collapse confirmed).

## Files Modified

- `src/openreply/graph/export.py` — layout grid, accordion CSS/HTML/JS, Selection
  auto-expand in `showNodeDetails`.
