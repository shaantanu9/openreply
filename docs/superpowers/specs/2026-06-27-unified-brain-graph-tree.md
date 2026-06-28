# OpenReply — Unified "Brain": merge persona + agent knowledge into one graph + tree/graph views

**Date:** 2026-06-27
**Status:** Approved (view = Graph+Tree toggle; merge = shared-post + embedding) — implementing

## Problem

Knowledge lives in two disconnected systems and there's no way to see it:
- **Structural graph** `graph_nodes`/`graph_edges` (topic-scoped): post/user/source/
  painpoint/workaround/product/feature_wish; semantic edges via MiniLM ONNX.
  Nodes carry `evidence_post_id`.
- **Persona brains** `persona_memories`/`persona_edges`/`persona_conclusions`
  (persona-scoped): lessons → associative edges → clustered beliefs. Memories
  carry `source_post_id`.
They only combine at query time as a text blend (`knowledge.build_knowledge_context`),
never as one persistent graph. UI shows counts/lists — no visual graph or tree.

## Goal

One **unified brain** per agent that merges its structural graph + every linked
persona's memories + beliefs into a single connected graph, with **cross-links**
binding memories/beliefs to the structural concepts they're about. Render it as
an interactive **graph** and a collapsible **tree**, toggleable.

## The join (how knowledge actually merges)

- **Exact (shared post):** a `persona_memories.source_post_id` that equals a
  `graph_nodes.evidence_post_id` → cross-edge `grounds` (memory → structural node).
- **Belief → memory:** `persona_conclusions.evidence_memory_ids` → edges `concludes`.
- **Semantic (embedding):** embed memory `lesson` + structural node `label` via the
  existing MiniLM ONNX embedder; cross-edge `about` when cosine ≥ threshold
  (cap per node). Graceful skip if ChromaDB/embedder unavailable.
- Persisted in a new table `brain_links` (kept separate so we never pollute the
  topic-shared `graph_edges`).

## Backend — `src/openreply/reply/brain_unified.py` (new)

- `brain_links` table: `{id, agent_id, src, dst, kind, weight, created_at}`,
  index `(agent_id)`. Created in `_ensure`.
- `relink(agent_id, *, semantic=True) -> {grounds, concludes, about}`:
  builds the cross-links (exact + belief→memory always; semantic when available),
  idempotent (clear this agent's `brain_links` then rebuild).
- `unified_brain(agent_id, *, node_cap=400) -> {graph:{nodes,edges}, tree, stats}`:
  - **Nodes** (namespaced ids to avoid collisions):
    - `g:<node_id>` structural (group=kind, label) for `agent.topic`
    - `m:<pid>:<mem_id>` memory (group=memory, lens, importance)
    - `b:<pid>:<concl_id>` belief (group=belief, lens, confidence)
  - **Edges**: `graph_edges` (topic) remapped to `g:` ids; `persona_edges`
    → `m:` ids; belief→memory `concludes`; `brain_links` cross-links.
  - **tree**: Agent → [each Persona/lens → Beliefs → Memories → evidence excerpt]
    + a Structural branch (Topic → painpoints → workarounds/products).
  - **stats**: node/edge counts by group + cross-link counts.

## CLI — `cli/agent_cmds.py`

- `agent brain [--id] --json` → `unified_brain`
- `agent brain-relink [--id] [--no-semantic] --json` → `relink`

## Rust — `commands.rs` + `main.rs`

- `agent_brain(id)`, `agent_brain_relink(id, semantic)` → register in handler.

## Frontend

- `api.js`: `agentBrain(id)` (SWR-cached), `agentBrainRelink(id, semantic)`
  (write → invalidates `agent`). Prewarm `agentBrain`.
- New route **`brain`** + nav item "Brain" (icon `brain-circuit`) under Intelligence.
- `dynamic.js renderBrain(view)`:
  - Header + **Rebuild brain** (relink) button + node-count stats.
  - **Toggle: Graph ⇄ Tree.**
  - **Graph:** lightweight canvas force-directed layout (O(n²) is fine at <~400
    nodes): repulsion + spring + center gravity, ~150 ticks then settle; nodes
    colored by group (belief/memory/painpoint/product/user/source/post), radius by
    degree; drag a node; click → detail panel (label, lens, evidence). Legend +
    per-group filter chips.
  - **Tree:** nested collapsible lists from `tree`.
  - Empty + non-Tauri fallbacks; `skeleton.js` brain variant.

## Non-goals
- No external graph lib (custom canvas force sim).
- No write-back into the topic-shared `graph_edges` (cross-links isolated in
  `brain_links`).
- Cross-agent merging — scoped to the active agent + its linked personas.

## Testing
- `relink` on the real app DB: reports grounds/concludes/about counts; idempotent.
- `unified_brain`: returns merged nodes/edges with correct namespaced ids; stats
  reconcile; tree has personas→beliefs→memories.
- `cargo check` 0 errors; `node --check` clean; live render in app.
