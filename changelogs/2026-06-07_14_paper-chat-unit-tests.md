# Research Mode — cited-Q&A core unit tests

**Date:** 2026-06-07
**Type:** Tests

## Summary

7 unit tests for `research.paper_chat`'s deterministic helpers — previously only
covered end-to-end (which needs an LLM). Hardens the heart of the research
experience (cited answers) against regressions in citation bookkeeping.

## Coverage

- `_short_author` (surname, "et al." for multi-author, [deleted]/None → "")
- `_year_of` (unix ts → year, 0/None/garbage → "")
- `_NOISE_SECTIONS` membership (references/acknowledgments excluded, results kept)
- `_no_knowledge_message` (guidance + retrieval-note passthrough)
- `_format_sources_block` (empty → "", numbered linked entries, §sections)
- `_build_context` (one citation per paper, numbered by first appearance,
  sections aggregated, author/year resolved; empty → ("", []))

7/7 pass.

## Files Created
- `tests/test_paper_chat.py`, `changelogs/2026-06-07_14_paper-chat-unit-tests.md`
