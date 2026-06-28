# Agent ↔ Persona Knowledge Blend

> **Updated:** 2026-06-27 · The canonical reference for how an OpenReply **Agent**
> (product/brand) blends a **Persona's** own learned knowledge (memories + graph +
> beliefs) into the replies and content it writes.

## The one-sentence idea

Each **Agent** carries a product/brand voice; each **Persona** is a single-lens
learning mind that accumulates its own knowledge base + semantic graph + synthesised
beliefs. Linking personas to an agent makes the agent **write from that accumulated
mind** — product framing on the outside, real learned knowledge on the inside.

## Two subsystems (and how they now connect)

| | **Agent** (product side) | **Persona** (learning side) |
|---|---|---|
| Code | `src/openreply/reply/` | `src/openreply/persona/` |
| Identity | `brand`, `niche`, `persona` (voice), `tone`, `audience` | `name`, `goal`, `lens`, `system_prompt` |
| Knowledge | shared topic corpus (`posts`/`topic_posts`) | own `persona_memories` (lens-distilled lessons) |
| Graph | `graph_*` (topic-wide) | `persona_edges` + per-persona ChromaDB collection |
| Beliefs | — | `persona_conclusions` (synthesised from memory clusters) |
| Table | `agents`, `reply_state` | `personas`, `persona_memories`, `persona_edges`, `persona_conclusions` |

**The bridge:** `agent_personas(agent_id, persona_id, weight)` — a many-to-many join.
One agent can blend several lenses (e.g. `psychology` + `finance`), each with a blend
`weight`.

## The learning loop (why this is "real learning")

```
teach (youtube / video / media)  ┐
auto-ingest (posts × lens)        ├─► persona_memories   (lessons, importance, tags)
                                  ┘        │
                       embed + link  ──────►  persona graph   (persona_edges + ChromaDB)
                                             │   "related knowledge"
                       synthesize_conclusions ─► persona_conclusions   (beliefs / "real mind")
                                             │
        reply / content blend  ◄── retrieve(beliefs + memories + graph neighbors + corpus)
```

Not neural fine-tuning — a **persistent memory-palace mind**. Each teach makes recall
richer and beliefs firmer, in SQLite + Chroma. The reply blend is where that mind is
finally *spent* on output.

## The blend, step by step

`reply/knowledge.py::build_knowledge_context(agent_id, query, corpus_topic, …)`:

1. **Beliefs first** — `agent_beliefs()` pulls top conclusions across all linked
   personas (highest confidence first), lens-tagged. This is the persona's "formed
   point of view." (`reply/knowledge.py`)
2. **Memories** — `retrieve_for_agent()` allocates `k_mem=6` slots across linked
   personas **proportional to weight** (`proportional_alloc`), then for each persona
   runs `persona/retrieve.py::retrieve()` (Chroma cosine → keyword fallback).
3. **Graph neighbors** — each retrieved memory is expanded 1-hop via
   `persona/graph.py::neighbors()` (strongest `persona_edges` first), tagged
   `_neighbor` — the "related knowledge."
4. **Corpus** — `corpus_limit=4` top topic posts by score, for freshness.
5. The four blocks fold into one prompt section: **beliefs → memories → neighbors →
   corpus**.

### Where it plugs in

- **`reply/content.py::generate_content`** — query seed = `angle or context_text or
  agent keywords`. (posts / threads / scripts / youtube / articles / follow-ups)
- **`reply/generate.py::generate_reply`** — query seed = the opportunity post text
  (title + body) we're replying to.

### Query seeding

- A real query (angle / post text / keywords) → similarity retrieval.
- Blank query → persona's **highest-importance memories** (`retrieve` degrades to
  `ORDER BY importance DESC`).

### Safety / no-regression

- **Agent with no linked personas** → beliefs + memories are empty → the block is just
  corpus excerpts = the exact pre-blend behaviour. Zero regression.
- **Chroma unavailable** → `retrieve()` falls back to keyword LIKE over
  `persona_memories`. Never crashes.
- **Deleted persona** → `list_linked_personas` drops the dangling link.

## Entry points

**CLI** (`cli/agent_cmds.py`):
```
openreply agent link-persona <persona_id> [--agent <id>] [--weight 2.0]
openreply agent unlink-persona <persona_id> [--agent <id>]
openreply agent personas [--agent <id>]
```
**MCP** (`mcp/tools/persona_tools.py`): `openreply_agent_link_persona`,
`openreply_agent_unlink_persona`, `openreply_agent_personas`.

## File map

| Concern | File | Key symbols |
|---|---|---|
| Blend core | `reply/knowledge.py` | `build_knowledge_context`, `retrieve_for_agent`, `agent_beliefs`, `proportional_alloc`, `_corpus_excerpts` |
| Agent ↔ persona links | `reply/agent.py` | `link_persona`, `unlink_persona`, `list_linked_personas`, `agent_personas` table in `_ensure` |
| Shared retrieval | `persona/retrieve.py` | `retrieve`, `retrieve_semantic`, `retrieve_keyword` |
| Graph neighbors | `persona/graph.py` | `neighbors` |
| Beliefs | `persona/conclude.py` | `list_conclusions` |
| Content blend | `reply/content.py` | `generate_content` |
| Reply-draft blend | `reply/generate.py` | `generate_reply` |
| Tests | `tests/test_reply_knowledge_blend.py` | 9 cases (alloc math, fallback, multi-persona, neighbors, beliefs) |

## Data-flow summary

```
create agent (brand/niche/voice)        → agents
create persona (goal/lens)              → personas
teach / ingest                          → persona_memories  → embed+link → persona_edges + Chroma
synthesize                              → persona_conclusions
link-persona agent↔persona (+weight)    → agent_personas
reply draft / content generate:
   query = post text | angle | keywords
   beliefs(conclusions) + memories(weighted) + graph neighbors + corpus(4)
   → one prompt → LLM → on-brand, knowledge-grounded draft
```
