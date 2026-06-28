# Engagement-weighted RRF ranking + openreply cleanup

**Date:** 2026-06-27
**Type:** Feature + Refactor

## Summary

Folded last30days' engagement-weighted RRF ranking into OpenReply's opportunity engine,
then cleaned the openreply Python down to the OpenReply keep-set (removed 96 research
modules). Verified the whole engine still imports and runs.

## Changes

- `reply/rank.py` (new): engagement (log-scaled votes/comments/views), freshness decay,
  per-platform RRF fusion → composite `final = 0.55·base + 0.20·rrf + 0.15·engagement +
  0.10·freshness`. Platform trust weights (reddit 1.0 … news 0.5).
- `reply/opportunity.py`: scores candidates → `rank.fuse_and_rank()` → persists `final`
  as `score` plus `engagement`/`freshness`/`rrf` components, sorted by final.
- `reply/schema.py`: added `engagement`/`freshness`/`rrf` columns (idempotent for old DBs).
- **Cleanup:** removed 96 research modules (papers, academic, product, consultancy
  frameworks); `research/` 106→10 files. Trimmed `research/__init__.py` to keep-set.
  Guarded `graph/semantic.py` tactic_library import.
- Docs: `OPENREPLY_MASTER.md` (ranking + cleanup), `OPENREPLY_RESHAPE.md` (status → done).

## Verified
- Deterministic rank unit test (high-engagement/recent floats up).
- Live `openreply reply find` (RRF-ranked Reddit opportunities).
- `openreply.cli.main` + `openreply.mcp.server` import; `reply/agent/content/discover/info` run clean.

## Files Created
- `src/openreply/reply/rank.py`
- `changelogs/2026-06-27_08_rrf-ranking-and-openreply-cleanup.md`

## Files Modified / Removed
- Modified: `reply/{opportunity,schema,__init__}.py`, `research/__init__.py`, `graph/semantic.py`, docs
- Removed: 96 `src/openreply/research/*.py` modules
