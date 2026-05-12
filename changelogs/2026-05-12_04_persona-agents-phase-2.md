# Persona agents — Phase 2 (connections + conclusions + auto-ingest)

**Date:** 2026-05-12
**Type:** Feature

## Summary

Phase 1 gave each persona a memory and a chat. Phase 2 turns those
isolated memories into a **knowledge graph**, distills the dense parts
of that graph into **conclusions** (one-line falsifiable beliefs with
evidence trails), and wires an **auto-ingest hook** so the user doesn't
have to press Ingest after every collect.

Shipped as **4 separable commits** — each can be reverted independently
without rolling back the others.

## Visual flow (full Phase 1 + 2)

```
   collect any topic
         │
         ▼
       posts ───────────────────────────┐
         │                              │  (auto-ingest on collect:done — Phase 2d)
         ▼                              ▼
  for each active persona:        Persona "Psyche"
    ├── LLM filter+distill         lens=psychology
    │   (Phase 1a) ───────────────►persona_memories
    │                              ┌──────┴──────┐
    ├── embed lesson into          ▼             ▼
    │   chromadb collection     embed         persona_edges  (Phase 2a)
    │   (Phase 2a)              │             ^   cosine ≥ 0.45
    │                           ▼             │   top-K=5 per memory
    └── cosine-query top-K  ────┴────►(write)┘
        and write edges

  …later, on demand:
        persona_edges + union-find (weight ≥ 0.5, size ≥ 3)
          └──► clusters ──► LLM-synthesise belief in persona's voice
                            └──► persona_conclusions   (Phase 2b)

  Persona dashboard #/persona/<id>:
    [Memories] [Graph] [Conclusions] [Chat] [Ingest]   (Phase 2c)
```

## Smoke test (Psyche, lens=psychology)

Backfill ran over the 10 memories from Phase 1's lofi-study ingest:
- 10 memories embedded into `persona_memories_1` (MiniLM-L6-v2 ONNX)
- 27 edges written (cosine ≥ 0.45, max weight 0.889 between mem #6 and #9)
- union-find with weight floor 0.5 grouped 9 of the 10 memories into a single
  cluster (mem#1 — the only one about a generic "study environment" rather
  than music — sat below threshold and stayed solo)
- LLM synthesised the cluster into a single belief at confidence 0.90:
  > "Ambient sounds and calming music can enhance focus and productivity by
  > creating a soothing atmosphere, which positively influences emotional
  > states and subsequently affects behavior."

## Commits in this phase

| Commit  | Phase | Scope |
|---------|-------|-------|
| `3b5aafc` | 2a — embeddings + edges | `persona/graph.py`; `embed_and_link` hook in `ingest.py`; per-persona ChromaDB collection (`persona_memories_<id>`); top-K=5 cosine edges with weight floor 0.45; `edges_added` field on memory events; `backfill_persona()` for recompute |
| `0947fae` | 2b — conclusion synthesis | `persona/conclude.py`; union-find clustering (weight ≥ 0.5, size ≥ 3); LLM-distill cluster → belief w/ confidence; idempotent (refresh existing on same signature); new CLI subcommands `persona graph / backfill / conclude / conclusions`; 4 new Tauri commands + JS API entries |
| `4f7eecc` | 2c — UI tabs | Two new tabs in persona dashboard: **Graph** (vanilla force-directed SVG, no D3 dep, drag-able nodes, hover tooltips) + **Conclusions** (highest-confidence first list with evidence accordion). Backfill + Synthesise buttons stream live progress |
| `fb10ce9` | 2d — auto-ingest hook | `setupPersonaAutoIngest()` at app boot; LS-gated toggle on the Personas screen (off by default); 3 s debounce; fire-and-forget per topic |

## Files Created

- `src/reddit_research/persona/graph.py`
- `src/reddit_research/persona/conclude.py`
- `changelogs/2026-05-12_04_persona-agents-phase-2.md`

## Files Modified (only Phase-2 hunks; all other in-flight edits left untouched)

- `src/reddit_research/persona/__init__.py` — re-export graph + conclude APIs.
- `src/reddit_research/persona/ingest.py` — call `embed_and_link()` after each `_store_memory()`; emit `edges_added` on `event=memory`.
- `src/reddit_research/cli/persona_cmds.py` — 4 new subcommands: `graph`, `backfill`, `conclude` (streams), `conclusions`.
- `app-tauri/src-tauri/src/persona_cmds.rs` — 4 new `#[tauri::command]` (graph / backfill / conclude streaming / conclusions).
- `app-tauri/src-tauri/src/main.rs` — register the 4 new handlers in `generate_handler!`.
- `app-tauri/src/api.js` — `api.personaGraph`, `api.personaBackfill`, `api.personaConclude`, `api.personaConclusions`, `api.onPersonaConcludeProgress`, `api.onPersonaConcludeDone`.
- `app-tauri/src/main.js` — boot-time call to `setupPersonaAutoIngest()`.
- `app-tauri/src/screens/personas.js` — Graph + Conclusions tabs, force-sim renderer, auto-ingest toggle UI, `setupPersonaAutoIngest` export.

## Where Phase 3 picks up

- **Memory palace as rooms (the "mirofish learning" link).** Each `persona_conclusion` becomes a "room" inside the palace, scoped to that persona's collection. Chat retrieval can then be scoped to one persona's rooms instead of a flat keyword LIKE search. The plumbing is already there — `persona/graph.py::_get_collection` reuses the palace client, so `palace.search_posts(collection_name=…)` will be a 5-line change once the rooms abstraction lands.
- **Cross-persona drag/drop.** Drag a memory chip from one persona's dashboard onto another persona's nav-link → fires `personaCreate` distillation through the receiver's lens (LLM re-frame the lesson). Pure UI work — no schema changes.
- **Semantic chat over memories.** Today `chat.py` uses keyword LIKE retrieval over `lesson + excerpt + tags`. Swap for `coll.query(query_texts=[question], n_results=k)` against the per-persona collection for the same recall the Graph tab uses. 10 lines.
- **Conclusion-aware chat.** Inject the top-3 highest-confidence conclusions into the chat system prompt as "your established beliefs", separately from the retrieved memories. Single prompt-template edit.
- **Multi-persona dashboard.** A `#/agents` overview that shows the same collect feeding 3 personas in parallel, with mini-graphs and "what each is learning right now". Vue-of-the-orchestra view, no new backend.
