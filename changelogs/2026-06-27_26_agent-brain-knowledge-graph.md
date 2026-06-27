# Agent brain + knowledge graph (content & connections)

**Date:** 2026-06-27
**Type:** Feature

## Summary

Gave an OpenReply agent a **real knowledge graph** over its collected content and
connections, reusing the existing graph builders and the ChromaDB **"Palace"
(memplace)** MiniLM embeddings — no new model. The graph machinery
(`gapmap.graph`) and the persona semantic-memory brain already existed, but the
graph builders were **never invoked from the agent path**, so the agent's
Knowledge page showed `graph_nodes = 0`. This wires the canonical build chain to
the agent and surfaces it in the UI.

## What now happens

- **Semantic memory brain (already worked):** each learn pass distills posts into
  persona memories embedded in the per-persona ChromaDB collection (the Palace)
  and linked by cosine similarity (`persona_edges`) — powering reply/content
  retrieval.
- **Content knowledge graph (new):** the agent's collected posts/authors/
  subreddits/comments are now mapped into `graph_nodes`/`graph_edges`, and —
  on a deep build — the niche's painpoints / feature wishes / product
  complaints / workarounds are LLM-mined and connected by embedding similarity
  (`relates_to` / `potentially_solves` / `could_address` / `co_evidenced`).

## Flow

- `reply/brain.py` (new):
  - `build_brain_for_agent(agent_id, deep=False, provider=None)` — runs
    `graph.build_structural` (content graph, no LLM) → optional
    `graph.enrich_from_llm` (deep: mine insights) → `graph.relations.
    build_semantic_relations` (embedding connections) → `backfill_source_evidence`.
    Best-effort; never raises.
  - `graph_overview(agent_id)` — counts by node kind, top hubs (most-connected
    nodes), and strongest semantic connections, for the UI.
- `reply/learn.py` — every learn pass now builds the structural graph (cheap)
  so the brain stays current.
- CLI: `gapmap agent build-graph [--deep]`, `gapmap agent graph`.
- Tauri: `agent_build_graph`, `agent_graph`; api.js: `agentBuildGraph`,
  `agentGraph`.
- Knowledge UI: a **"Brain & knowledge graph"** card showing node/edge counts by
  kind, top hubs, semantic connections, and a **"Build brain (deep)"** button.

## Verification

On a 13-post test agent:
- `agent build-graph` (light): `graph_nodes` 0 → **32** (13 posts, 9 users,
  7 sources, 2 eras, topic), 46 structural edges.
- `agent build-graph --deep`: LLM mined **4 painpoints, 1 feature wish,
  2 workarounds, 1 product**; **41 nodes / 87 edges**, including real
  embedding `relates_to` connections (e.g. "Searchability of notes" ↔
  "Proton Pass: Searchability", weight 0.839).
- `agent graph` overview returns kinds + hubs + connections.
- `cargo check` finished clean.

## Files Created

- `src/gapmap/reply/brain.py`
- `changelogs/2026-06-27_26_agent-brain-knowledge-graph.md`

## Files Modified

- `src/gapmap/reply/learn.py` — auto-build structural graph each learn pass
- `src/gapmap/cli/agent_cmds.py` — `agent build-graph` + `agent graph`
- `app-tauri/src-tauri/src/commands.rs` — `agent_build_graph` + `agent_graph`
- `app-tauri/src-tauri/src/main.rs` — command registration
- `app-tauri/src/or/api.js` — `agentBuildGraph` + `agentGraph`
- `app-tauri/src/or/dynamic.js` — Knowledge "Brain & knowledge graph" card

## Notes

- The Knowledge "Angles / findings" KPI reads a separate `findings` table;
  semantic insights are stored as `graph_nodes` (painpoint/workaround/…), so the
  new graph card (not that KPI) is the accurate view of mined insights.
- Engagement/semantic richness scales with corpus size and BYOK model quality.
