# Abstract Enrichment + Citation Edges — push coverage toward 100%

**Date:** 2026-06-08
**Type:** Feature

## Summary

Two follow-ups to the abstract-fallback work, closing the last coverage gaps for
paper chat + relations:

1. **Abstract enrichment** — backfill missing abstracts for *title-only* papers
   (PubMed search carries no abstract; some OpenAlex/Crossref/Scholar rows are
   metadata-only). ~3,957 academic papers had `< 200` chars of `selftext` and so
   could not be embedded (no text → no chat, no relations). Each is now fetched
   from its source and written to `posts.selftext`, then chunk-embedded.

2. **Citation edges** (`paper_cites`) — build real paper→paper citation links
   from the Semantic Scholar references API (the PDF-based extractor only works
   on the ~few-percent of papers with open-access full text). For each paper we
   fetch its reference list and match references to in-corpus papers by **exact
   DOI / arXiv / PMID**, then materialize `paper_cites` edges on the map.

## Abstract enrichment

- New per-source single-paper fetchers:
  - `sources.pubmed.fetch_abstract(pmid)` — NCBI efetch (esummary has no abstract)
  - `sources.openalex.fetch_work_abstract(work_id)` + `fetch_work_abstract_by_doi(doi)`
  - `sources.semantic_scholar.fetch_abstract(paper_id)` (abstract → TLDR fallback)
  - reuses existing `sources.crossref.fetch_by_doi(doi)`
- New `research/paper_abstract_enrich.py`:
  - `enrich_abstract(post_id)` — dispatch by source, **OpenAlex-by-DOI cross-source
    fallback** (best abstract coverage) for Crossref/Scholar gaps, write selftext.
  - `enrich_topic_abstracts(topic=None, …)` — batch + inline chunk-embed.
- Verified hit rates: PubMed + OpenAlex enrich reliably; Crossref jumps 0→~75%
  with the DOI fallback; Scholar (S2-hash ids, no DOI) often genuinely has none.

## Citation edges

- New `sources.semantic_scholar.fetch_reference_ids(paper_id)` — lightweight
  reference rows with external ids (DOI/arXiv/PMID), with a 429 Retry-After
  backoff.
- New `research/paper_citations.py::build_citations(topic, …)` — corpus id index
  (doi/arxiv/pmid → post_id), per-paper reference fetch, exact-id match, writes
  resolved `paper_references` rows (`extractor='s2_api'`), then
  `paper_relations.build(kinds=['cites'])`.
- **Limitation (documented):** S2's unauthenticated quota is tiny — bulk runs
  need a free `S2_API_KEY`; without it, fetches 429 and the run is partial. Also,
  in-corpus citation density is naturally sparser than semantic similarity (papers
  must cite *each other* within the topic), so `relates_to` remains the dense
  signal and `cites` is the high-precision supplement.

## Surfaces

- CLI: `gapmap research paper-enrich-abstracts [--topic …]`,
  `gapmap research paper-citations [--topic …] [--limit N]`.
- MCP: `gapmap_paper_enrich_abstracts`, `gapmap_paper_citations`.

## Files Created

- `src/gapmap/research/paper_abstract_enrich.py`
- `src/gapmap/research/paper_citations.py`

## Files Modified

- `src/gapmap/sources/pubmed.py` — `fetch_abstract`.
- `src/gapmap/sources/openalex.py` — `fetch_work_abstract`, `fetch_work_abstract_by_doi`.
- `src/gapmap/sources/semantic_scholar.py` — `fetch_abstract`, `fetch_reference_ids` (+ `time` import, 429 backoff).
- `src/gapmap/cli/main.py` — `paper-enrich-abstracts`, `paper-citations` commands.
- `src/gapmap/mcp/server.py` — `gapmap_paper_enrich_abstracts`, `gapmap_paper_citations` tools.
