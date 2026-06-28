# Map tab: working relation selection + selection-aware chat

**Date:** 2026-06-04
**Type:** Fix + Feature

## Summary

The topic **Map** tab had three real problems: (1) when you selected a node, the
"Relations" summary in the detail panel was silently empty because it looked for
edge kind `related_to` while the dense semantic edges are actually stored as
`relates_to` + `co_evidenced`; (2) **relation edges were not clickable at all** —
only nodes had a click handler, so clicking a relationship did nothing; and (3)
the Map chat was **context-free** — the iframe never told the parent app what was
selected, so answers were always grounded on the whole topic, never "this
finding." This change fixes the relation labelling, makes edges clickable, adds a
bidirectional selection bridge (iframe → parent), and makes the Map chat
selection-aware (it now grounds its answer on the selected node/relation, shown
via a clearable "Focused on" chip in the chat drawer). No Rust, schema, or
backend prompt changes — the selection context is injected into the question
string sent to `start_chat`.

## Changes

- **Relations show on select:** corrected the relation-kinds list in the viewer's
  node detail panel to `relates_to, co_evidenced, potentially_solves,
  could_address, source_evidence` (was `related_to`, which never matched).
- **Relation edges are clickable:** added a transparent fat hit-area layer over
  each (1px) edge, plus `selectEdge` / `highlightEdge` / `showEdgeDetails` —
  clicking a relation highlights it + both endpoints and shows an edge-detail
  panel with click-through to either finding.
- **Selection bridge (iframe → parent):** `selectNodeById` and `selectEdge` now
  `postMessage({type:'openreply:select', selection:{…}})` to the host app with the
  node/edge + its relations.
- **Selection-aware Map chat:** `topic.js` listens for `openreply:select`, stores
  the selection, shows a clearable **"Focused on: ‹label› ✕"** chip in the chat
  drawer head, and prepends a concise context preamble (selection + its
  relations) to the question sent to `start_chat`. The chat log still shows only
  the user's typed text. Clearing the chip returns the chat to topic-wide.
- **Auto-heal:** bumped `MAP_EXPORT_VERSION` 3 → 4 so every topic re-exports the
  new viewer on first open (no manual Rebuild needed).

## Files Modified

- `src/openreply/graph/export.py` — fixed relation-kinds list + `_neighborsOf`
  default; added `RELATION_KINDS`, `_selectionPayload`, `_postSelection`,
  edge hit-area layer, `selectEdge`/`highlightEdge`/`showEdgeDetails`, and the
  selection `postMessage` from `selectNodeById`.
- `app-tauri/src/screens/topic.js` — bumped `MAP_EXPORT_VERSION`; added
  `_selectedMapNode` state, `wireMapSelectionBridge`, `_renderMapFocusChip`,
  `_selectionChatPreamble`; wired the bridge + chip into `wireMapChat`; injected
  the preamble in `_mapChatSend`; added the `#mapchat-focus` chip container.
- `app-tauri/src/style.css` — styles for `.mapchat-focus` / `.mapchat-focus-chip`.

## Verification

- `node --check` passes on `topic.js` and on the extracted viewer JS.
- `python3 -m ast` parse OK on `export.py`.
- `npm test` — 50/50 pass.
- `npm run build` (vite) — 1786 modules transformed, build succeeds.
- Runtime click/chat verification: run `npm run tauri:dev`, open a topic's Map,
  click a node and a relation edge, then "Ask this map".
