# Paper relationship map — connect the dots across a topic's research papers

**Date:** 2026-06-01
**Type:** Feature

## Summary

Added a **Paper Map**: a relationship graph of a topic's academic papers, reachable from the Papers tab. Papers are connected four ways and rendered as an interactive force-graph so the user can "find the relation and create a map for the research papers". Builds on the existing `paper_relations` materializer (which already produced `paper_relates_to` + `paper_cites` edges into `graph_edges`).

## Changes

- `src/openreply/research/paper_relations.py`:
  - Extended `build()` with two new edge kinds — `paper_shared_finding` (two papers both linked to the same openreply-map finding, via `finding_research_links`) and `paper_same_author` (shared first author). Default `kinds` now covers all four (`ALL_KINDS`).
  - New `get_paper_map(topic, rebuild=False)` reader → D3 force-graph JSON `{ok, nodes, edges, stats}`. Nodes = topic's academic papers (capped at 200 by citations) with source/year/cites/author/has_fulltext; edges read back from `graph_edges` (`paper_*` kinds), labelled `semantic / cites / shared finding / same author`. Lazily materializes edges on first call. Pure-read, never raises; semantic degrades gracefully when ChromaDB/embeddings are unavailable.
- `src/openreply/cli/main.py`: new `research paper-map --topic [--rebuild] --json` command.
- `app-tauri/src-tauri/src/commands.rs`: new `paper_map` Tauri command (shells to `research paper-map`); registered in `main.rs`.
- `app-tauri/src/screens/paperMap.js` (NEW): self-contained Paper Map screen — calls `invoke('paper_map')` directly, computes a deterministic dependency-free SVG force layout, colours nodes by source / sizes by citations, colours edges by relation kind with a togglable legend, click-to-inspect side panel, Rebuild button.
- `app-tauri/src/main.js`: import + route `#/paper-map/<topic>`.
- `app-tauri/src/screens/papers.js`: "View map" button in the Papers toolbar → opens the map for the topic.
- `app-tauri/src/style.css`: legend/swatch/node-hover styles.

## Files Created

- `app-tauri/src/screens/paperMap.js`
- `changelogs/2026-06-01_09_paper-relationship-map.md`

## Files Modified

- `src/openreply/research/paper_relations.py`, `src/openreply/cli/main.py`, `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`, `app-tauri/src/main.js`, `app-tauri/src/screens/papers.js`, `app-tauri/src/style.css`

## Verification

- Python: `get_paper_map()` on the real DB (topic with 528 academic papers) → 200 nodes, edges built lazily, graceful when a signal is absent.
- `cargo check` passes (paper_map command + registration).
- `npm run build` passes (new screen, route, papers button, styles).

## Notes

- There is no standalone in-app "graph view" screen to embed paper nodes into, so the three surfaces are: the dedicated Paper Map screen + the Papers-tab "View map" entry (the inspect side-panel is the third). Citation/semantic/shared-finding edges populate as the user runs reference extraction, chunk embedding, and research linking respectively.
