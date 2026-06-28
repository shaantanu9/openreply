# Paper-research MCP toolkit — Semantic Scholar, Crossref, citation graph, paper analysis

**Date:** 2026-04-21
**Type:** Feature

## Summary

Turns OpenReply's MCP server into a first-class paper-research tool without spinning up a separate app. Decision recorded: **keep it in OpenReply** for now — 80% of the infrastructure (Palace semantic index, SQLite, graph, Solutions Agent, 4 paper sources) is already built, the differentiator is the fusion of user pain + science, and pre-splitting for an unvalidated academic audience is premature. If paper-research telemetry shows up, forking a lean "OpenReply Science" variant reusing the same sidecar is a 1-day job.

## Changes

**Two new source modules** (ready-to-upsert row shape, same as arxiv/pubmed/openalex/scholar):
- `sources/semantic_scholar.py` — 220M papers, citation graph, influential-citation metric, TLDR summaries. Free; `S2_API_KEY` env var raises rate limit. Functions: `fetch_semantic_scholar`, `fetch_citations` (who cites this?), `fetch_references` (what does this cite?).
- `sources/crossref.py` — authoritative DOI metadata, funder/grant info, reference lists for paywalled papers. Free; `CROSSREF_MAILTO` env var puts us in the polite pool. Functions: `fetch_crossref`, `fetch_by_doi`.

**9 new MCP tools** (server.py, paper-research toolkit block):
- `openreply_fetch_semantic_scholar(query, limit, year_from, open_access_only)`
- `openreply_paper_citations(paper_id, limit)` — accepts S2 id / DOI / arXiv id
- `openreply_paper_references(paper_id, limit)`
- `openreply_fetch_crossref(query, limit, year_from, filter_type)`
- `openreply_fetch_by_doi(doi)` — one-shot canonical lookup
- `openreply_research_papers(query, topic, limit_per_source, sources, year_from, persist)` — multi-source search across 6 paper sources in parallel, deduped by id, auto-persisted to `posts` and tagged to `topic` for downstream `semantic_search` / `graph_build` / `analyze_papers_bulk`
- `openreply_analyze_paper(topic, post_id, force)` — LLM summary / claims / methods / tier / relevance (cached in `paper_analyses`)
- `openreply_analyze_papers_bulk(topic, limit, force)` — batch analysis, citation-ordered
- `openreply_paper_analyses(topic, limit)` — read cached LLM analyses, no LLM call

Claude can now do end-to-end literature review without touching the app UI:

```
mcp__reddit-myind__reddit_research_papers(query="mitochondrial dysfunction fatigue", topic="CFS")
  → 120 papers across 6 sources, deduped, persisted, indexed into Palace

mcp__reddit-myind__reddit_paper_citations(paper_id="10.1038/s41586-020-2649-2", limit=20)
  → forward citation walk

mcp__reddit-myind__reddit_semantic_search(query="evidence X causes Y", source_type="pubmed", topic="CFS")
  → hybrid vector+BM25 within the corpus

mcp__reddit-myind__reddit_analyze_papers_bulk(topic="CFS", limit=30)
  → LLM-extracted claims + tier per paper

mcp__reddit-myind__reddit_paper_analyses(topic="CFS")
  → read everything back for a report
```

## Verified

Live API hits (no mocks):
- Semantic Scholar: "attention is all you need" → 173,357 citations / 19,637 influential returned in 2s
- Crossref: "spaced repetition memory" → real journal records with DOIs

All 13 paper-related MCP tools register cleanly. ChromaDB + graph pipeline unchanged — paper sources already flow through the same `upsert_posts` path.

## Strategic note

The decision to keep this in OpenReply (vs. forking a "OpenReply Science" app) is recorded in the changelog for this entry's own reasoning. Revisit when:
- Academic-audience signups (if we ever add auth) exceed 100 users
- Paper-source MCP calls outnumber Reddit-source MCP calls in aggregate telemetry
- Someone asks for Zotero integration or institutional SSO (both imply a dedicated product)

Until then, the fusion is the moat — don't split it.

## Files Created

- `src/reddit_research/sources/semantic_scholar.py`
- `src/reddit_research/sources/crossref.py`
- `changelogs/2026-04-21_06_paper-research-mcp.md` — this entry

## Files Modified

- `src/reddit_research/mcp/server.py` — 9 new paper-research tools
