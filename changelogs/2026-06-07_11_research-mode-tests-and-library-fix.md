# Research Mode — unit tests + library "no such table" fix

**Date:** 2026-06-07
**Type:** Fix + Tests

## Summary

Added 11 unit tests for the Research Mode backend (paper_reading, paper_library,
lit_matrix non-LLM paths). The tests caught a real bug: `paper_library.library()`
LEFT JOINs `paper_reading_status`, which is created by `paper_reading`, so opening
the Library before ever setting a reading status crashed with "no such table".
Fixed by ensuring the reading table exists inside `library()`.

## Changes

- **Fix** `research/paper_library.py`: `library()` now ensures the
  `paper_reading_status` table exists (reuses `paper_reading._ensure_tables`)
  before the LEFT JOIN.
- **Tests** `tests/test_research_mode.py`: reading status roundtrip + bad-value
  guard, queue/counts, highlights CRUD + same-span idempotency, read_view shape,
  collections + membership, library listing + status filter, lit_matrix `_parse`
  + empty read/export. 11/11 pass.

## Regression

Full suite: 169 passed, 2 skipped, 2 failed — both pre-existing & environmental
(live-Reddit 403; mcp-probe timeout flaky under full-suite load, passes in
isolation). No regression from Research Mode.

## Files Created
- `tests/test_research_mode.py`, `changelogs/2026-06-07_11_research-mode-tests-and-library-fix.md`

## Files Modified
- `src/gapmap/research/paper_library.py`
