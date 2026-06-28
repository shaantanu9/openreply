# Paper Knowledge Workflow + Gap Detection — Design

**Date:** 2026-06-01
**Status:** Implemented & validated (OCR topic, 180 papers)

## Problem

The paper pipeline pieces existed but didn't connect, and one was never built:
- Full text was fetched only for *top-cited* papers, not all.
- Summaries (`paper_analyses`) were partial; `analyze_papers_bulk` silently
  skipped `semantic_scholar` / `crossref` sources.
- Paper↔paper relations existed (`paper_relations.py`) but ran separately.
- **`paper_gaps` was a table with no implementation** — nothing ever detected
  literature patterns or gaps, so the user had no "where are the open problems"
  view to position a new paper against.
- Everything was manual CLI/MCP steps; the user wanted one in-app workflow.

## Goal

One Papers-tab button drives the whole flow for a topic, with live progress:

```
collect papers (academic) → download full text (all) → summarize each
   → build paper↔paper relations → detect patterns & gaps → synthesize insights
   → [generate draft → export with citations]
```

## Architecture

Follows the existing command-registration triangle and the enrich streaming
pattern, reusing individually-tested implementations:

| Layer | Component |
|---|---|
| Gap detector (new) | `research/paper_gaps.py` — `detect_gaps` / `list_gaps` |
| Orchestrator (new) | `research/paper_workflow.py` — `build_paper_knowledge` |
| Reused stages | `paper_fulltext.fetch_bulk`, `paper_analyze.analyze_papers_bulk`, `paper_relations.build`, `insights.synthesize_insights` |
| Draft (improved) | `paper_pipeline.paper_draft_generate` folds gaps into the prompt |
| CLI | `research paper-knowledge` (NDJSON `--stream`), `research paper-gaps` |
| Tauri | `paper_knowledge_build` (stream), `paper_gaps_list` |
| Frontend | `api.js` wrappers + listeners; `papers.js` workflow panel |

### Gap detector

Four kinds → `paper_gaps(id, topic, kind, title, detail_json,
evidence_post_ids_json, score, created_at)`:
- `temporal` — deterministic, year-histogram (active-then-dormant /
  emerging-thin). Works with no LLM.
- `understudied_intersection`, `contradiction`, `method_replication` — one
  consolidated LLM call over a compact corpus overview (top-N by citations:
  index, year, citations, one-line summary). Evidence cited by index, mapped
  back to post_ids; evidence-less items dropped.

Fail-soft: always returns the temporal gaps even with no LLM; never raises.
Stable `gap_<sha1>` ids so re-runs upsert.

### Orchestrator

`build_paper_knowledge(topic, scope=all|top50|top25|abstracts, force,
provider, progress_cb)` runs the five stages, each fail-soft (a stage error is
recorded and the pipeline continues). Resumable — skips cached full text /
existing analyses / existing edges. Emits `workflow:start`, `stage:start`,
`stage:progress`, `stage:done`, `workflow:done` for the UI stepper.

### Streaming bridge

CLI `--stream` prints `{"_event": …}` NDJSON (flush=True). Rust
`run_cli_enrich_streaming(app, args, "paper:knowledge:progress",
"paper:knowledge:done")` forwards stdout → progress event and fires done on
exit. Per-topic dedup via `ActiveGraphOps` (60-min stale window — full runs are
long). Frontend subscribes with the TDZ-safe `let unlisten = null` pattern.

## Validation

OCR topic (180 papers): full text 172 processed / 5 new / 167 not-OA; 171
summarized (8 transient 429s, fail-soft); 40 same-author edges; all 4 gap kinds
with evidence; full insight synthesis; grounded draft. `cargo check` 0 errors;
`vite build` ok.

## Out of scope / follow-ups

- Retry/backoff for provider 429s during bulk summarize (P2).
- `relates_to` semantic edges depend on the palace (chromadb) — populated in
  the app, 0 in dev CLI (P2).
- Auto-trigger the workflow on collect for a "research paper" goal (deferred —
  kept explicit + user-triggered to control cost).
