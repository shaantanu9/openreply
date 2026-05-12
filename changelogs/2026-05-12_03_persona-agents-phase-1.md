# Persona agents — Phase 1 (foundations end-to-end)

**Date:** 2026-05-12
**Type:** Feature

## Summary

Adds **persona agents** to the app — always-on learning agents with a single
lens (e.g. "Psychology", "Market gaps", "App design"). Every collected post,
regardless of topic, is offered to each active persona; the persona's LLM
filter decides whether the post says anything about its lens, and if yes,
distills a 1-3 sentence lesson into its own memory with a source-post
evidence trail. Users can later chat with the persona — answers come
**only** from its memories, with `(M#)` citations linking back to the
underlying lessons.

Phase 1 ships the full vertical: SQLite schema, Python module, CLI, Tauri
commands, and the desktop UI (list + per-persona dashboard with Memories +
Chat + streaming Ingest tabs). Phase 2 (knowledge-graph edges between
memories + conclusion synthesis) and Phase 3 (drag/drop between personas +
memory-palace integration) will land separately.

Shipped as **5 separable commits** so the feature can be rolled back from
main without disturbing other in-progress branch work.

## Concept

```
                          (collect any topic — reddit / yt / hn / arxiv / …)
                                      │
                                      ▼ posts land in `posts`
        ┌─────────────────────────────┴─────────────────────────────┐
        ▼                             ▼                              ▼
   Persona "Psyche"            Persona "MarketHunter"        Persona "Designer"
   lens=psychology             lens=market-gap               lens=design
        │                             │                              │
   LLM filter+distill:           LLM filter+distill:            LLM filter+distill:
   "what does this say          "what unmet need does          "what design pattern
    about psychology?"           this expose?"                  does this reveal?"
        │                             │                              │
        ▼                             ▼                              ▼
   persona_memories            persona_memories              persona_memories
   (psychology lessons)        (market-gap lessons)          (design lessons)
        │                             │                              │
        ▼                             ▼                              ▼
   Chat / Graph / Conclusions  Chat / Graph / Conclusions   Chat / Graph / Conclusions
```

Same corpus, different agents, different lessons — one lens per agent.

## End-to-end smoke test

1. Collect "lofi study" via the new yt-dlp YouTube source (10 comments).
2. `reddit-research persona ingest -p 1 -t "lofi study" --limit 10` →
   Psyche distilled 10 psychology lessons (mood-congruity, environment
   priming, nostalgia, novelty-driven distraction…).
3. `reddit-research persona chat 1 "How does environment and sound affect
   focus?"` → 200-word synthesised answer citing M1, M3, M4, M5, M6.

## Commits in this feature

| Commit  | Phase | Scope |
|---------|-------|-------|
| `5fdb83c` | 1a — DB schema + Python module | `personas`, `persona_memories`, `persona_edges`, `persona_conclusions` tables (idempotent migration); `persona/__init__.py`, `store.py`, `ingest.py`, `chat.py` |
| `c33c259` | 1b — CLI | `reddit-research persona list / create / update / delete / ingest / memories / chat`; NDJSON streaming on `ingest --json` |
| `993b741` | 1c — Tauri commands + JS API | 7 Rust commands in `persona_cmds.rs`, mod+handler wiring, `api.personaIngest()` etc. with `onPersonaIngestProgress` listener |
| `4bb2ac6` | 1d — UI | `screens/personas.js` (list + dashboard), routes `#/personas` + `#/persona/<id>`, "Agents" nav section |
| (this)    | 1e — changelog | Index entry |

## Files Created

- `src/reddit_research/persona/__init__.py`
- `src/reddit_research/persona/store.py`
- `src/reddit_research/persona/ingest.py`
- `src/reddit_research/persona/chat.py`
- `src/reddit_research/cli/persona_cmds.py`
- `app-tauri/src-tauri/src/persona_cmds.rs`
- `app-tauri/src/screens/personas.js`
- `changelogs/2026-05-12_03_persona-agents-phase-1.md`

## Files Modified (only the persona-related hunks; pre-existing edits in these files were left untouched)

- `src/reddit_research/core/db.py` — added `_ensure_persona_schema(db)` helper and its call in `init_schema`. Seeds a default "Psyche" persona on fresh install.
- `src/reddit_research/cli/main.py` — 2-line registration of the persona Typer sub-app at the bottom of the file.
- `app-tauri/src-tauri/src/main.rs` — `mod persona_cmds;` + 8 entries in `tauri::generate_handler![…]`.
- `app-tauri/src/api.js` — 19-line block of `api.personaList`, `api.personaIngest`, listener helpers, etc.
- `app-tauri/src/main.js` — import + 2 routes for `#/personas` and `#/persona/<id>`.
- `app-tauri/index.html` — new "Agents" nav section with one link.

## Possibilities / what's next

- **Phase 2 — Connections.** Embed every `persona_memory.lesson` via the
  existing palace MiniLM/ONNX pipeline, then run `build_semantic_relations`
  (already used for findings in `graph/relations.py`) over the per-persona
  collection. Top-N cap per memory prevents hairballs. Output:
  `persona_edges` rows of `kind=relates_to|supports|contradicts`.
- **Phase 2b — Conclusions.** Cluster the edge graph (Louvain), feed each
  cluster's memories into an LLM "what belief do these support?" prompt,
  store as `persona_conclusions` with `evidence_memory_ids` array.
- **Phase 3 — Memory-palace integration ("mirofish learning").** Each
  persona gets its own private ChromaDB collection under
  `retrieval/palace.py`. Conclusions become "rooms"; chat retrieval scopes
  to the active persona's collection. Same MiniLM-ONNX as the main palace,
  zero new infrastructure.
- **Phase 3b — Cross-persona sharing.** Drag-drop a memory onto another
  persona's card to seed that persona with a translated version (LLM
  re-distill through the receiver's lens). Useful for getting a
  market-hunter to consider a psychology insight.
- **Phase 4 — Auto-ingest hook on `collect:done`.** Wire `commands.rs`
  collect-done listener to fan out `persona_ingest:start` events for every
  active persona, so the user doesn't have to press "Ingest" manually after
  each collect. Already supported by the Python side — just needs the
  trigger.
