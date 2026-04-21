# Node-click detail panel: "Linked to" section + metadata preview + cache-bust

**Date:** 2026-04-21
**Type:** Fix / UX

## Summary

User reported clicking a node in the Map tab no longer surfaced useful detail. Two issues:

1. **On-disk HTML was stale.** `loadMap()` reuses the cached export from prior runs when `force=false`, so the iframe loads an older viewer that predates recent export changes. Worse, Tauri's `convertFileSrc` URL is identical across reloads so the browser also uses its HTTP cache.
2. **`showNodeDetails()` only rendered edges of 4 specific kinds** (`evidenced_by / wished_in / about_product / built_in`). Any node connected via `has_painpoint`, `has_feature_wish`, `addresses`, `cites`, `similar_to`, `mentions`, `has_temporal_gap`, etc. had its edges silently dropped. The panel fell through to a raw-JSON metadata dump, which looked empty for semantic nodes whose metadata is minimal.

## Changes

### `src/reddit_research/graph/export.py::showNodeDetails`

Rebuilt the panel around three sections:

1. **Header** — kind pill + truncated node id (full id on hover).
2. **Metadata preview** — promotes high-value fields (`summary`, `evidence`, `importance`, `satisfaction`, `frequency`, `classification`) to a visible row block instead of hiding them in the raw JSON tail.
3. **Linked to** — `_neighborsOf(nodeId)` walks every edge touching the node, groups by edge kind, and renders each group as a collapsible list of clickable neighbor rows:
   - Arrow indicator (`→` out, `←` in) so directionality is visible.
   - Neighbor kind pill + label.
   - External link icon when the neighbor has a `permalink`/`url`.
   - Top 12 per group + "+ N more" overflow so a node with 200 post edges stays scannable.
   - Clicking a neighbor row calls `selectNodeById()` — the detail panel becomes a keyboard-free graph walker.
4. **Evidence posts** — kept as a dedicated section for semantic kinds (`painpoint`, `product`, `workaround`, `feature_wish`, `temporal_gap`) so posts stay quick to scan even when other edge kinds dominate.
5. **Raw metadata** — collapsed under a `<details>` at the bottom.

`EDGE_LABEL` dict maps the 15 common edge kinds to human-readable strings. Unknown kinds fall back to the raw `kind.replace('_', ' ')` so nothing is hidden silently.

New CSS rules in `.details .node-*` — ~35 lines covering the redesigned sections. Uses existing tokens (`--bg`, `--border`, `--accent`, `--muted`, `--text`) so the viewer inherits whatever theme it's rendered in.

### `app-tauri/src/screens/topic.js::loadMap`

`<iframe src="${fileUrl}?t=${Date.now()}">` — cache-bust the iframe on every mount. Forces the webview to re-fetch the HTML file, picking up any export that was regenerated while the app was running.

### Stale-export cleanup (one-time)

`rm -f ~/Library/Application\ Support/com.shantanu.gapmap/reddit-myind/gap-map-*.html` — the cached HTML on disk predates this fix, so `exportHtml` would hand back the old file without the new `showNodeDetails` logic. Cleared them so the next Map-tab mount rebuilds fresh.

## Verification

- Python import check → `from reddit_research.graph.export import export_graph_html` clean.
- 6 stale viewer HTMLs removed.
- App restarted; next click on any node will re-export + render the new detail panel.

## UX delta

Before:
- Click painpoint → only 4 edge kinds rendered → most connections hidden → panel often just shows "Metadata: {raw JSON}" with zero neighbor context.
- Click temporal-gap → 0 evidence edges of the 4 kinds → panel looks empty beyond the JSON.
- Stale export means changes to the panel don't reach the user at all.

After:
- Click any node → "Linked to" shows every edge kind grouped, counted, and clickable.
- Neighbors are labeled with their kind + title, not just an ID.
- Metadata preview surfaces `summary` / `evidence` / `importance` / `satisfaction` / `frequency` at the top instead of burying them in raw JSON.
- Every iframe load is fresh — no stale view of the graph.

## Files Modified

- `src/reddit_research/graph/export.py` — `showNodeDetails` rebuild + CSS rules
- `app-tauri/src/screens/topic.js` — iframe cache-bust
