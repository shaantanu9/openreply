# Research-paper flow: LLM-grounded draft, real citations, file export, chunk wiring

**Date:** 2026-06-01
**Type:** Feature

## Summary

Closed the weak link in the research-user journey identified by the subsystem audit: the "research → draft → cite → export" tail. Previously the paper draft was hardcoded boilerplate, the "citations" were painpoint counts (not papers), export was markdown-only, and paper chunking/embedding was never wired into the pipeline. This change makes the draft LLM-grounded and paper-cited, adds real academic references + docx/PDF export, and populates paper chunks during the normal pipeline. (Companion changelogs `_15` gap-finding-uses-cached-paper-fulltext and `_16` pubmed-pmc-fulltext-resolution cover the other two audit fixes.)

## Changes

### Paper writing pipeline (`src/gapmap/research/paper_pipeline.py`)
- **LLM-grounded draft** — `paper_draft_generate` now builds an IMRaD draft via the LLM from (a) top findings, (b) the topic's academic papers (title/venue/year/abstract, up to 12 via `paper_export._papers_for_topic`), and (c) cached full-text excerpts for the top 3 papers (`get_full_text_or_abstract(..., max_chars=2500)`), with inline `[n]` citations matching a passed reference list. Prompt bounded to ~12k chars. The previous hardcoded body is preserved as `_template_draft(...)` and used as a graceful fallback when no LLM is configured / no papers / LLM error. Adds `grounded` + `papers_used` to the return.
- **Real references in export** — `paper_export_with_citations` now appends a real `## References` section (numbered APA via `to_apa` + a BibTeX block via `to_bibtex`) over the topic's academic papers, in addition to the existing painpoint citation appendix. Adds `papers_cited`.
- **File export (docx/PDF)** — `paper_export_with_citations` accepts `format in ("markdown","docx","pdf")`; writes the assembled markdown to `<data_dir>/exports/papers/<slug>/` and renders via `export_deck.build_docx_from_markdown` / `build_pdf_from_markdown` (pandoc). Returns `path` + `engine`; falls back to writing the `.md` and returning its path with a `note` if the renderer/pandoc is unavailable. Markdown format keeps the existing `{content}` shape.

### Paper chunking wired into the pipeline (`src/gapmap/mcp/server.py`)
- `gapmap_paper_research_pipeline._pipeline_impl` now calls `chunk_paper(post_id, embed=True)` for each paper that got full text (respecting the existing `max_fulltext` cap), guarded by `palace.is_available()` and per-paper try/except. Adds `papers_chunked` to the result. This populates `paper_chunks_collection` for papers fetched via the normal flow, so paper-chunk semantic search/chat is no longer dark for app users.

## Verification

- All changed modules import together cleanly; `paper_draft_generate` returns `grounded:True, papers_used:12`; export returns `papers_cited:50` and writes a docx (pandoc engine) to disk.
- Test suite: 14 passed; the 1 failure (`test_discover_subs_returns_real_results`) is a live-network test unrelated to these changes.

## Files Modified

- `src/gapmap/research/paper_pipeline.py` — LLM draft + template fallback, real references, docx/pdf export.
- `src/gapmap/mcp/server.py` — chunk+embed step in the research pipeline.
