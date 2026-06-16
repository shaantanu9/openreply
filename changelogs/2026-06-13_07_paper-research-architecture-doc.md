# Paper & Multi-Source Research Architecture Doc

**Date:** 2026-06-13
**Type:** Documentation

## Summary

Wrote a detailed reference doc explaining how Gap Map searches research papers
and every other external source — the common `posts`-row contract, the shared
HTTP politeness layer, the 6 academic sources, the citation graph, the one-call
`run_paper_research` orchestrator, the LLM analysis/tier layer, and the full
MCP + CLI surface. Includes a step-by-step recipe for porting the pattern into
another app/MCP (the original ask: "how are we fetching papers and all sources,
we want to add this pattern in another app"). Every section carries real
`file:line` citations from the `multi-source` branch.

## Changes

- Documented the keystone idea: all sources return the identical `posts` row so
  dedup/vector/graph/sentiment/analysis work with zero per-source code.
- Documented the three load-bearing conventions (`score`=citations,
  `selftext`=embed text, `permalink=None` for non-Reddit).
- Mapped the 6 academic sources (arxiv/pubmed/openalex/semantic_scholar/crossref/
  scholar + europepmc) with when-to-use, key requirements, rate-limit hacks.
- Documented citation-graph traversal (forward/backward references via S2).
- Traced the 8-stage `run_paper_research` pipeline and the MCP/CLI tool surface.
- Captured battle-tested gotchas (academic-source literal drift, JATS XML in
  Crossref abstracts, S2 rate limits, broken permalink links).
- Added Path A/B porting recipe + the 6-file "add a source" recipe + split-or-
  merge decision.

## Files Created

- `docs/specs/PAPER_RESEARCH_ARCHITECTURE.md`
- `changelogs/2026-06-13_07_paper-research-architecture-doc.md`

## Files Modified

- None
