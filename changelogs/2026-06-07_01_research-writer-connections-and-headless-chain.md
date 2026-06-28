# Research & paper-writing assistant — Connect the Dots + headless writing chain

**Date:** 2026-06-07
**Type:** Feature

## Summary

First implementation pass toward making OpenReply a tool researchers, paper-writers
and PDF-reading students use to ingest literature, **find connections nobody has
made before**, analyse them, and write the paper. A capability inventory
(`docs/RESEARCH-WRITER-PLAN.md`) showed ~80% of the engine already exists; this
pass ships the missing differentiator (a novel-connection engine) and completes
the headless flow so the entire pipeline is driveable from Claude Code.

## Changes

- **NEW — Connect the Dots (`research/connections.py`):** blends already-computed
  signals into novel cross-paper connections ranked by a novelty score:
  understudied intersections + contradictions + under-replicated methods (from
  `paper_gaps`) and shared-but-uncited parallel findings (`paper_shared_finding`
  edges minus `paper_cites`). Optional LLM "why is this new" pass. Persists to
  `strategy_artifacts` (kind `connections`). `connections_get` (pure read) +
  `connections_compute`. Wired: CLI `research connections [--compute]`, Rust
  `connections_get/_compute`, api `connectionsGet/Compute`, **Connect Dots** tab
  (`screens/connections.js` — novelty bars, kind chips, evidence), MCP
  `openreply_connections`. Proven on `ocr and table data image to text`: 6 ranked
  connections, persisted + read back.
- **Completed the headless research-writing chain (MCP):**
  `openreply_paper_knowledge_build` (one-shot fulltext→sections→gaps→insights),
  `openreply_paper_gaps` (read/compute), `openreply_paper_relations_build`. Combined
  with the pre-existing `openreply_paper_outline_generate` / `…_draft_generate` /
  `papers_export`, Claude Code can now run: build_knowledge → relations_build →
  connections → outline → draft → export (BibTeX/RIS/APA).

## Confirmed already-present (no build needed)

- Citations: `paper_export.to_bibtex/to_ris/to_apa/to_markdown` + `papers-export`
  CLI/Rust/api + Papers-tab export buttons (proven generating real BibTeX/RIS/APA).
- Writing: Papers tab "Build knowledge base" + "Generate paper draft" (modal),
  outline/draft via `paper_pipeline` (Rust+api+MCP).
- PDF RAG: `paper_fulltext` + `paper_sections`/`paper_chunks` + grounded chat.

## Files Created

- `docs/RESEARCH-WRITER-PLAN.md` (detailed plan: personas, flow, novelty engine, roadmap)
- `src/openreply/research/connections.py`
- `app-tauri/src/screens/connections.js`

## Files Modified

- `src/openreply/cli/main.py` — `research connections`.
- `app-tauri/src-tauri/src/commands.rs` + `main.rs` — `connections_get/_compute`.
- `app-tauri/src/api.js` — `connectionsGet/Compute`.
- `app-tauri/src/screens/topic.js` — Connect Dots import/tab/loader.
- `src/openreply/mcp/server.py` — `openreply_connections` + 3 paper-chain tools.

## Known gaps / next

- R4 (student "drop PDF → cited Q&A" lightweight surface) — next build.
- P2: MLA citation format + LaTeX `.tex`+`.bib` export; connection "bridge"
  detection from community structure (currently intersections + uncited pairs).
