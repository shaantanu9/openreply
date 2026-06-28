# Unified Brain — merge persona + agent knowledge into one graph + tree/graph views

**Date:** 2026-06-28
**Type:** Feature

## Summary

Welded the two previously-disconnected knowledge systems into ONE brain and made
it visible. Before: the structural topic graph (`graph_nodes`/`graph_edges`) and
each persona's memory graph (`persona_memories`/`persona_edges`/
`persona_conclusions`) never joined — they were only blended as a transient text
string at query time, and the UI showed counts/lists with no visual graph. Now a
new **Brain** screen renders the merged graph (interactive canvas force-directed)
and a hierarchical tree, with cross-links that bind persona memories/beliefs to
the structural concepts they're about.

## How knowledge merges (cross-links, persisted in new `brain_links` table)

- **grounds** — memory → structural node sharing a source post
  (`persona_memories.source_post_id` == `graph_nodes.evidence_post_id`)
- **concludes** — belief → its evidence memories (`evidence_memory_ids`)
- **about** — memory ↔ concept by MiniLM-ONNX embedding similarity (cosine ≥ 0.42,
  capped per memory); graceful skip if the embedder is unavailable

Verified on real data: 53 cross-links (27 concludes + 26 semantic about),
74 nodes, 226 edges across 2 personas.

## Changes

- `reply/brain_unified.py` (new): `relink(agent_id, semantic=True)` builds the
  cross-links (idempotent); `unified_brain(agent_id)` returns
  `{graph:{nodes,edges}, tree, stats}` with namespaced ids
  (`g:`/`m:`/`b:`), node groups, and a persona→beliefs + structural-concepts tree.
  New `brain_links` table.
- CLI `agent_cmds.py`: `agent brain`, `agent brain-relink [--no-semantic]`.
- Rust `commands.rs`: `agent_brain`, `agent_brain_relink` (registered in `main.rs`).
- Frontend `api.js`: `agentBrain` (SWR-cached) + `agentBrainRelink`; `agent_graph`
  also cached; brain prewarmed in `main.js`.
- Frontend `dynamic.js`: `renderBrain` + a dependency-free **canvas force-directed
  graph** (`forceGraph`: repulsion + springs + cooling alpha, node drag, click-to-
  inspect, neighbor highlight, color by group) + a **Tree** view (personas →
  beliefs, structural concepts by degree) with a Graph⇄Tree toggle and a Rebuild
  (relink) button. New **Brain** nav item (`network` icon); `skeleton.js` brain variant.

## Files Created

- `src/openreply/reply/brain_unified.py`
- `docs/superpowers/specs/2026-06-27-unified-brain-graph-tree.md`
- `changelogs/2026-06-28_01_unified-brain-graph-tree.md`

## Files Modified

- `src/openreply/cli/agent_cmds.py` — brain + brain-relink commands
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — agent_brain(_relink)
- `app-tauri/src/or/api.js`, `app-tauri/src/main.js` — API + cache + prewarm
- `app-tauri/src/or/dynamic.js` — renderBrain + force-graph + tree
- `app-tauri/src/or/shell.js` — Brain nav item
- `app-tauri/src/or/skeleton.js` — brain skeleton

## Verification

- `relink` + `unified_brain` tested on the real app DB (74 nodes / 226 edges /
  53 cross-links; semantic embedder live).
- `cargo check` 0 errors; `node --check` clean (5 files); CLI `agent brain` /
  `brain-relink` registered.

## Known gaps / follow-ups

- `grounds` (exact shared-post) links found 0 here because the personas learned
  from different posts than the structural graph; semantic `about` bridged them.
- Force layout is O(n²) per tick — fine to a few hundred nodes; would need
  quadtree/Barnes-Hut for thousands. Node cap = 400.
