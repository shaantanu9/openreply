# Agent ↔ Persona Knowledge Blend

**Date:** 2026-06-27
**Type:** Feature

## Summary

Wired the two previously-disconnected halves of the system together: a product/brand
**Agent** (`reply/agent.py`) can now blend one or more learning **Personas'** own
knowledge — their lens-distilled memories, their semantic graph, and their synthesised
beliefs (conclusions) — into the replies and content it generates. Before this change
the reply blend only used the shared topic corpus; the personas' richer learned
knowledge was never fed into the prompt. Agents with no linked personas behave exactly
as before (corpus-only), so there is no regression.

## Changes

- New many-to-many link `agent_personas(agent_id, persona_id, weight)` bridging the
  `agents` and `personas` tables (additive schema, created in `reply/agent.py::_ensure`).
- New blend core `reply/knowledge.py`: `build_knowledge_context` assembles
  **beliefs → memories → graph neighbors → corpus** into one prompt section.
  `retrieve_for_agent` allocates `k_mem=6` memory slots across linked personas
  proportional to weight (`proportional_alloc`), each expanded 1-hop via the persona
  graph. `agent_beliefs` pulls top conclusions across linked personas.
- Extracted the persona retrieval primitive out of `persona/chat.py` into a shared
  `persona/retrieve.py` (`retrieve` / `retrieve_semantic` / `retrieve_keyword`) so the
  reply engine and chat share one Chroma→keyword fallback code path. `chat.py` re-imports
  it (behaviour unchanged).
- Added `persona/graph.py::neighbors()` — 1-hop graph expansion (strongest edge first,
  deduped against the seed set) for "related knowledge."
- Agent CRUD: `link_persona`, `unlink_persona`, `list_linked_personas` (lens-hydrated,
  drops dangling links) in `reply/agent.py`.
- Blend plugged into `reply/content.py::generate_content` (query = angle/context/keywords)
  and `reply/generate.py::generate_reply` (query = the opportunity post text).
- CLI: `gapmap agent link-persona|unlink-persona|personas` (`cli/agent_cmds.py`).
- MCP: `gapmap_agent_link_persona|unlink_persona|personas` (`mcp/tools/persona_tools.py`).
- Tests: `tests/test_reply_knowledge_blend.py` — 9 cases (slot-allocation math,
  corpus-only fallback, single + weighted multi-persona retrieval, graph-neighbor
  expansion, belief ordering). All pass; existing persona tests still pass.

## Files Created

- `src/gapmap/persona/retrieve.py` — shared persona memory retrieval primitives.
- `src/gapmap/reply/knowledge.py` — the agent↔persona knowledge blend core.
- `tests/test_reply_knowledge_blend.py` — blend unit tests.
- `docs/agent-persona-blend-flow.md` — canonical flow + design reference.

## Files Modified

- `src/gapmap/reply/agent.py` — `agent_personas` table + link CRUD.
- `src/gapmap/reply/content.py` — blend into `generate_content`.
- `src/gapmap/reply/generate.py` — blend into `generate_reply`.
- `src/gapmap/persona/chat.py` — re-import retrieval from `persona/retrieve.py`.
- `src/gapmap/persona/graph.py` — new `neighbors()` 1-hop expansion.
- `src/gapmap/persona/__init__.py` — export `neighbors`.
- `src/gapmap/cli/agent_cmds.py` — link/unlink/personas commands.
- `src/gapmap/mcp/tools/persona_tools.py` — agent↔persona link MCP tools.
