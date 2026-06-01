# Gap-finding uses cached academic paper full text instead of abstract excerpts

**Date:** 2026-06-01
**Type:** Feature

## Summary

`find_gaps` ran its four LLM extractors over a corpus where academic papers
were represented by a ≤500-char abstract excerpt (`substr(selftext,1,500)`),
so the methodology / results / limitations from downloaded PDFs never reached
the gap extractors. This change makes the gap-finding path substitute a
bounded slice of each academic paper's **already-cached** full text for the
abstract — only when full text is on disk, never triggering a PDF download
inside the gap-finding hot path. Non-academic rows (reddit / hn / appstore /
playstore / youtube / etc.) and all other callers of `corpus_for` are
unchanged.

## Changes

- Added opt-in `prefer_fulltext: bool = False` to `corpus_for` (`collect.py`).
  Default False keeps every existing caller (MCP server, CLI, semantic graph,
  temporal split) byte-for-byte identical.
- For academic rows only — source types `arxiv`, `openalex`, `crossref`,
  `pubmed`, `semantic_scholar`, `scholar` (`_ACADEMIC_SOURCES`) — when
  `prefer_fulltext=True`, the top ~15 academic papers by engagement ordering
  get their `selftext` replaced with a cached full-text slice and a
  `_fulltext` flag set.
- Cached full text is read directly from disk via
  `paper_fulltext._cache_path(source, post_id)` (recomputed from the CURRENT
  data root, since the stored `paper_full_texts.cache_path` can be stale after
  a data-dir move). We deliberately do NOT call `get_full_text` because it
  downloads on a cache miss; `_cached_fulltext_slice` only ever reads an
  existing file and returns None otherwise (clean abstract fallback, no
  regression).
- Slice strategy: a head window (title + abstract + intro/methods start,
  2200 chars) plus a results/findings/limitations/discussion window for long
  papers, joined with `[…]`, capped at 3500 chars per paper.
- `gaps.run_extractor` gained a matching `prefer_fulltext` param and now
  renders the corpus via new `_format_corpus_mixed`, which gives `_fulltext`
  rows a wide 4000-char excerpt window (so the substituted slice isn't
  re-clipped to the 600-char Reddit excerpt) while leaving every other row at
  the normal excerpt length. Falls back to the standard `format_corpus` when
  no row is flagged.
- `find_gaps` enables `prefer_fulltext` by default (both its corpus-size probe
  and each extractor call); disable with env `GAPMAP_GAPS_FULLTEXT=0` for
  small-context providers.

## Caps chosen

- Per paper: 3500 chars (2200 head + results window).
- Number of academic papers substituted: top 15 by engagement order.
- Render window for substituted rows: 4000 chars (>= 3500 so no re-truncation).

## Verification

- `ast.parse` of both edited files: OK.
- Imports of `corpus_for` + `find_gaps`: OK.
- Topic `public speaking anxiety app` (5 cached arXiv papers): all 5 abstracts
  (986–1513 chars) replaced with 3505-char full-text slices; rendered corpus
  grew +14,524 chars; rendered slice contains real paper body + `[…]` results
  window.
- Regression: default `corpus_for` path sets no `_fulltext` flags and renders
  byte-identical to the old `format_corpus`; zero non-academic rows changed
  under `prefer_fulltext=True`.

## Files Modified

- `src/gapmap/research/collect.py` — `corpus_for` gained `prefer_fulltext`
  param; added `_ACADEMIC_SOURCES`, fulltext caps, `_cached_fulltext_slice`,
  `_apply_fulltext`.
- `src/gapmap/research/gaps.py` — `run_extractor` gained `prefer_fulltext`
  param; added `_format_corpus_mixed` + `_FULLTEXT_EXCERPT_CHARS`; `find_gaps`
  enables full text by default (env-gated by `GAPMAP_GAPS_FULLTEXT`).
