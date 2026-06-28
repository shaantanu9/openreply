# Persona agents — Phase 3 (semantic chat + memory-palace link + cross-persona share)

**Date:** 2026-05-12
**Type:** Feature

## Summary

Closes the original three-line user request: *"a person/agent will learn
what he intended to learn… he will learn the psychology from that and
store in his memory finding the connections and graph properly using the
summary and knowledge graph and conclusion from that… multiple agents
likewise … with chat to interact and drag … also link the mirofish
learning to this all."*

| User ask | Where it landed |
|---|---|
| "person/agent will learn what he intended to learn" | Phase 1a — `persona/store.py` + `ingest.py` |
| "learn psychology from any topic, store in memory" | Phase 1a — LLM filter+distill into `persona_memories` |
| "finding the connections and graph properly" | Phase 2a — ChromaDB cosine edges into `persona_edges` |
| "summary and knowledge graph and conclusion" | Phase 2b — union-find clustering + LLM belief synthesis into `persona_conclusions` |
| "multiple agents with their special dashboard, memory connections, ui, chat" | Phase 1d + 2c — `#/personas` list, `#/persona/<id>` Memories / Graph / Conclusions / Chat / Ingest tabs |
| "drag" between personas | **Phase 3b — `share_memory()` + "Share →" button on each memory card** |
| "link the mirofish learning to this all" | **Phase 3a — chat retrieval is now cosine-query over the per-persona ChromaDB collection (= memory palace per persona)** |

## Phase 3 commits

| Commit  | Phase | Scope |
|---------|-------|-------|
| `1f85fca` | 3a — semantic chat + conclusion priming | `chat.py` retrieves via per-persona ChromaDB cosine query (the "mirofish learning" link); fallback to keyword if Chroma is missing; top-3 conclusions injected into the system prompt as `[C1] [C2] [C3]` "established beliefs" with `(C#)` citation syntax alongside `(M#)`; UI shows retrieval kind + similarity per citation + beliefs accordion |
| `c3e1f56` | 3b — cross-persona memory share + UI polish | `persona/share.py` re-distills a memory through the receiver's lens (not a copy — the receiver might frame the same evidence completely differently); CLI `persona share -f <id> -m <id> -t <id>`; Tauri `persona_agent_share`; Memory cards gain a "Share →" button → modal lists every other active persona with one-click re-distillation. Includes a UI styling pass on the Personas list screen |

## Smoke test — cross-persona share

Created a second persona `MarketHunter` (lens=`market-gap`, color teal),
then shared `Psyche.mem#8` (psychology insight: "people are often
distracted by minor details, even in environments designed for focus,
due to curiosity and interest in novelty") to MarketHunter.

MarketHunter's lens re-distilled the same underlying evidence into:

> *"There is a potential market gap for products or services that help
> individuals maintain focus in environments where distractions are common,
> such as study spaces or workplaces."* (importance 0.6, tagged
> `shared_from:Psyche`)

This is exactly the "same corpus, different lenses" pattern the user
wanted — one collected post, two completely different lessons depending
on which agent's mind it lands in.

## Smoke test — semantic chat with conclusion priming

Asked Psyche "How does environment and sound affect focus?":
- **Retrieval kind:** semantic (cosine via `persona_memories_1` collection)
- **Top 5 memories** ranked by similarity 0.45–0.58
- **1 conclusion** auto-cited as `(C1)` in the answer: "Ambient sounds
  and calming music can enhance focus and productivity by creating a
  soothing atmosphere…"
- **Answer body** cited 5 memories + 1 conclusion naturally:
  *"My established belief [C1] also supports this … This is consistent
  with the lessons learned from memories [M1], [M2], [M3], [M4], and
  [M8]…"*

## Files Created

- `src/reddit_research/persona/share.py`
- `changelogs/2026-05-12_05_persona-agents-phase-3.md`

## Files Modified

- `src/reddit_research/persona/chat.py` — semantic retrieval primary, keyword fallback; conclusion priming; richer response payload (`retrieval`, `beliefs`, `similarity` per citation).
- `src/reddit_research/persona/__init__.py` — re-export `share_memory`.
- `src/reddit_research/cli/persona_cmds.py` — `persona share` subcommand.
- `app-tauri/src-tauri/src/persona_cmds.rs` — `persona_agent_share` command.
- `app-tauri/src-tauri/src/main.rs` — register the share handler.
- `app-tauri/src/api.js` — `api.personaShare(fromId, memId, toId)`.
- `app-tauri/src/screens/personas.js` — Share button on memory cards + share modal; chat tab shows retrieval kind / similarity / beliefs accordion; styling pass on the Personas list screen.

## Where this feature can go from here (Phase 4 ideas)

- **Conclusion-graph view.** Right now Graph shows memory→memory edges. A second view could show conclusion→conclusion edges (which beliefs reinforce each other vs. which contradict). Same `build_semantic_relations` machinery, different source.
- **Multi-persona orchestra screen.** A `#/agents` overview that pipes every collect into mini-cards for each active persona, with a live "what each agent is learning right now" feed. Pure UI.
- **Contradiction detection.** When `share_memory` is rejected with `receiver_lens_says_not_relevant`, record the rejection as a soft `contradicts` edge between donor and receiver memories. Over time this builds a map of where personas' worldviews diverge.
- **Persona-of-personas (meta-agent).** A persona whose lens is "find the pattern across all other personas' conclusions" — runs over `persona_conclusions` rather than `posts`. One-line CLI change since the ingest pipeline already takes arbitrary candidate rows.
- **Standalone app extraction.** The user mentioned "later we will make a proper separate app for this". Everything in `src/reddit_research/persona/` plus a thin Tauri wrapper around the existing commands ports cleanly — there are no Reddit-specific dependencies inside the persona module.
