# In-app "Build Knowledge & Write Paper" workflow + paper gap detection

**Date:** 2026-06-01
**Type:** Feature

## Summary

Turned the previously-separate, manual paper-research steps into one in-app
workflow on the Papers tab: collect papers → download full text (all) →
summarize each → build paper↔paper relations → **detect research patterns &
gaps** → synthesize insights → draft/export a paper grounded in all of it.
The headline new capability is a **paper gap detector** that finally populates
the long-empty `paper_gaps` table with four kinds of openings (understudied
intersections, contradictions, temporal gaps, method/replication gaps), each
cited to its evidence papers. Validated end-to-end on the "ocr and table data
image to text" topic (180 papers): full text fetched, 171 summarized, 40
relation edges, all 4 gap kinds detected, full insight synthesis, and a
grounded paper draft.

## Changes

- **New `paper_gaps.py`** — `detect_gaps(topic, …)` + `list_gaps(topic)`.
  Deterministic temporal detector (year histogram) + one consolidated LLM call
  for understudied-intersection / contradiction / method-replication gaps.
  Evidence cited by paper index → resolved to real post_ids. Fail-soft (never
  raises; works with no LLM via the temporal detector). Stable gap ids so
  re-runs upsert. Persists to `paper_gaps`.
- **New `paper_workflow.py`** — `build_paper_knowledge(topic, scope, …)` chains
  fulltext → summarize → relations → gaps → insights with a uniform
  `progress_cb(event, payload)` (workflow:start / stage:start / stage:progress /
  stage:done / workflow:done). Resumable (skips cached work); `scope` ∈
  all|top50|top25|abstracts; each stage is fail-soft.
- **`paper_pipeline.py`** — `paper_draft_generate` now pulls the detected gaps
  and adds a RESEARCH GAPS block to the prompt, instructing the model to
  position the paper's contribution against them (degrades cleanly when no gaps).
- **`paper_analyze.py`** — fixed `_ACADEMIC_SOURCES` which omitted
  `semantic_scholar` and `crossref`, so papers from those sources were never
  summarized.
- **`paper_fulltext.py`** — `fetch_bulk` gained an optional `progress(i, total,
  post_id, status)` callback for live per-paper counts.
- **CLI** — `openreply research paper-knowledge --topic … --scope … [--stream]`
  (NDJSON lifecycle events) and `openreply research paper-gaps --topic … [--detect]`.
- **Tauri** — `paper_knowledge_build` (streaming, deduped, fires
  `paper:knowledge:progress` / `paper:knowledge:done`) and `paper_gaps_list`
  commands; registered in `main.rs`.
- **Frontend** — `api.js` wrappers (`buildPaperKnowledge`, `paperGapsList`,
  `onPaperKnowledgeProgress`, `onPaperKnowledgeDone`); Papers-tab "Build
  Knowledge & Write Paper" panel in `papers.js` with a live 5-stage stepper,
  a gaps panel (4 categories with evidence), and Generate-draft / Export
  buttons. Uses the TDZ-safe `let unlisten = null` listener pattern.

## Files Created

- `src/openreply/research/paper_gaps.py`
- `src/openreply/research/paper_workflow.py`
- `docs/2026-06-01-paper-knowledge-workflow-design.md`

## Files Modified

- `src/openreply/research/paper_pipeline.py` — gaps block in draft prompt
- `src/openreply/research/paper_analyze.py` — full academic-source tuple
- `src/openreply/research/paper_fulltext.py` — `fetch_bulk` progress callback
- `src/openreply/cli/main.py` — `paper-knowledge` (stream) + `paper-gaps` commands
- `app-tauri/src-tauri/src/commands.rs` — `paper_knowledge_build` + `paper_gaps_list`
- `app-tauri/src-tauri/src/main.rs` — handler registration
- `app-tauri/src/api.js` — wrappers + event listeners
- `app-tauri/src/screens/papers.js` — workflow panel + gaps view + draft/export

## Validation

- Backend run end-to-end on "ocr and table data image to text" (180 papers):
  `workflow:done` ok=true, errors=[]. All 4 gap kinds detected with evidence.
- `cargo check` — 0 errors. `vite build` — built. Python AST parse — clean.

## Known gaps / follow-ups

- Summaries can hit provider 429s at high volume (nvidia free tier); the
  pipeline is fail-soft and continues. P2: add retry/backoff.
- `relates_to` semantic edges need the palace (chromadb) available; 0 in the
  dev CLI context, populated in the app. P2.
- Installed app needs a Tauri rebuild + reinstall to surface the new UI
  (frontend bundle + Rust compiled; full signed build is a separate step).
