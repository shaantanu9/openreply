# Task 7: persist_solutions module

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added `persist_solutions.py` to the research module, implementing three graph-persistence functions that upsert new node kinds (`evidence_paper`, `mechanism`, `intervention`) and their corresponding edges (`has_evidence`, `explained_by`, `addressed_by`, `supported_by`) into the loose-schema graph. All four TDD tests pass.

## Changes

- `persist_why_for_painpoint`: merges why-data dict into a painpoint node's `metadata_json` under the `why` key; skips on `_skipped`/`_parse_error` flags to protect previous successful runs
- `persist_papers_for_painpoint`: upserts `evidence_paper` nodes and `has_evidence` edges from a painpoint; returns count of papers persisted
- `persist_solutions_for_painpoint`: upserts a scoped `mechanism` node + `explained_by` edge, then each intervention as an `intervention` node + `addressed_by` edge, plus `supported_by` edges to pre-existing evidence_paper nodes; returns `{mechanisms_added, interventions_added, supporting_edges}` summary; no-ops on `_skipped` input

## Files Created

- `src/reddit_research/research/persist_solutions.py`
- `tests/test_solutions_persist.py`

## Files Modified

None
