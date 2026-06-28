# Persona agents — Phase 4 (meta-agents, orchestra, contradictions)

**Date:** 2026-05-12
**Type:** Feature

## Summary

Closes the Phase 3 backlog. Three new capabilities:

- **Phase 4a — persona-of-personas.** A persona can now read OTHER
  personas' conclusions through its own lens, producing meta-insights.
  MarketHunter reading Psyche's psychology beliefs gets market-gap
  takeaways from them.
- **Phase 4b — orchestra dashboard.** A new top-level route `#/agents`
  shows every active persona in one live grid that auto-refreshes every
  5 seconds. Watching it during a collect with auto-ingest on shows the
  agents learning in real time.
- **Phase 4c — contradiction detection.** Share rejections (when a
  receiver's lens says "not relevant") now land in a `persona_rejections`
  table and surface on the donor's Conclusions tab. Builds a map of
  where personas' worldviews diverge over time.

## Commits

| Commit  | Phase | Scope |
|---------|-------|-------|
| `05d1272` | 4a — persona-of-personas | `ingest_from_peers()` reads `persona_conclusions FROM other_personas`, re-distills each through the receiving persona's lens; dedup via `source_post_id="peer:<conclusion_id>"`; embeds + edge-links through the regular graph pipeline; new CLI `persona ingest-peers`, Tauri `persona_agent_ingest_peers` (streaming), `api.personaIngestPeers`, and an "Ingest peers" button next to "Run ingest" on the Ingest tab. Bundles a user-driven Chat-tab styling pass that landed in the same file. |
| `00c20dd` | 4b — orchestra dashboard | New route `#/agents` rendered by `renderAgentsDashboard()`; live grid of every active persona's lens, counts, top conclusion + last 3 memories; `setInterval(tick, 5000)` with MutationObserver-based cleanup so the timer dies when the route hands main over to another screen; "Orchestra" nav link under the Agents section. |
| `815508b` | 4c — contradictions | Additive migration adds `persona_rejections(id, from_persona_id, from_memory_id, to_persona_id, donor_lesson, reason, created_at)`; `share_memory()` writes a row when `parsed.relevant=false`; `list_rejections()` reader; CLI `persona rejections <id> [--direction involving|as_donor|as_receiver]`; Tauri + JS API; "Contradictions" panel on the Conclusions tab. |
| (this)    | 4d — changelog | Index entry |

## End-to-end smoke tests

### 4a — persona-of-personas
```
$ reddit-research persona ingest-peers 2 --limit 10
[peer] start — 1 peer-conclusion candidates
  ✓ mem#12: There is a potential market gap for innovative audio-based
            solutions that cater to individuals seeking to improve focus
            and productivity, particularly those who value calming
            atmospheres and soothing sounds.
[peer] done — kept=1 dropped=0 errors=0
```

Psyche's conclusion → MarketHunter's lens → fresh market-gap insight. The
new memory is tagged `peer_of:Psyche`, sources back to `peer:1` (the
conclusion id), and lands in MarketHunter's regular memory graph (with
its own cosine edges and contribution to its own future conclusions).

### 4b — orchestra dashboard
Navigate to `#/agents`. Both personas (Psyche + MarketHunter) render with
their lens chip, memory/edge/conclusion counts, top belief panel, and
latest 3 memories. The pulse indicator in the header ticks every 5s.

### 4c — contradictions
`persona_rejections` table created. Share-rejection writes are guarded
by try/except so the user-visible refusal response always succeeds even
if the log write fails. Conclusions tab now has a `Contradictions —
shares this persona refused (lens mismatches)` panel.

## Files Created

- `changelogs/2026-05-12_06_persona-agents-phase-4.md`

## Files Modified (only Phase-4 hunks — all pre-existing in-flight edits left untouched via manual patch / `git add -p`)

- `src/reddit_research/persona/__init__.py` — re-export `ingest_from_peers`, `list_rejections`.
- `src/reddit_research/persona/ingest.py` — new `ingest_from_peers()` + `_PEER_SYSTEM/_PEER_USER` prompts.
- `src/reddit_research/persona/share.py` — write `persona_rejections` row on lens refusal; new `list_rejections()` reader.
- `src/reddit_research/core/db.py` — `persona_rejections` table added inside the existing `_ensure_persona_schema` helper (one-row migration, idempotent).
- `src/reddit_research/cli/persona_cmds.py` — `persona ingest-peers` + `persona rejections` subcommands.
- `app-tauri/src-tauri/src/persona_cmds.rs` — `persona_agent_ingest_peers` (streaming) + `persona_agent_rejections` commands.
- `app-tauri/src-tauri/src/main.rs` — register the 2 new handlers.
- `app-tauri/src/api.js` — `api.personaIngestPeers`, `api.personaRejections`.
- `app-tauri/src/main.js` — `renderAgentsDashboard` import + `/agents` route.
- `app-tauri/index.html` — "Orchestra" nav link under Agents section.
- `app-tauri/src/screens/personas.js` — orchestra dashboard render fn + card; "Ingest peers" button on Ingest tab + handler; "Contradictions" panel on Conclusions tab.

## Where this can still go

- **Conclusion-graph view.** Same cosine machinery as Phase 2a, but
  source nodes are `persona_conclusions` instead of `persona_memories`.
  Lets you spot when two beliefs from different personas overlap or
  conflict directly. ~50 LOC.
- **Cross-persona conclusion-similarity index.** Build a `palace_meta`
  ChromaDB collection where IDs are `<persona_id>:<conclusion_id>` and
  documents are the belief statements. Query across all personas finds
  belief overlaps at a glance.
- **Standalone-app extraction.** Everything in
  `src/reddit_research/persona/` is independent of Reddit. To extract:
  copy the package + the 3 SQL tables + the 4 Phase-2/3/4 ChromaDB
  collections + a 200-LOC Tauri shell. The CLI is already self-contained
  via `cli/persona_cmds.py` and a 2-line `add_typer` registration.
- **Auto-ingest peers on collect:done.** Phase 2d auto-ingests posts;
  add a follow-up pass that auto-ingests peer conclusions so meta-agents
  stay current too. Single line in `setupPersonaAutoIngest`.
