# Paper Palace — Phase 1: Academic Source Guard + Paper-to-Paper Relationships

**Date:** 2026-05-31
**Type:** Feature

## Summary

Implemented Paper Palace Phase 1: an explicit academic-source guard at the embed boundary, paper→paper semantic similarity (`paper_neighbors`), materialized `relates_to` and `cites` edges into `graph_edges`, CLI + Rust/api.js wrappers, and pre-creation of the `paper_gaps` table for Phase 2. Built on top of the existing `paper_chunks` ChromaDB collection via TDD (6 tasks, 6 commits).

## Changes

- New `ACADEMIC_SOURCES` frozenset + `is_academic_source()` in `sources.py` — single source of truth replacing the hardcoded tuple in `intents.py:194`
- `chunk_paper()` guard: if `embed=True` and `source_type` is not academic, returns early with `skipped=non_academic_source` before any fulltext query
- `paper_neighbors(post_id, k, topic)` in `palace.py`: mean-pools chunk embeddings, queries collection, rolls up to paper level, excludes self, returns ranked results
- `paper_relations.py`: `build(topic, kinds)` materializes `relates_to` (chromadb similarity) and `cites` (resolved references) edges into `graph_edges`
- CLI: `research paper-neighbors --id <pid>` and `research paper-relations-build --topic <t> --kinds <k>`
- Rust commands: `paper_neighbors` and `paper_relations_build` in `commands.rs`, registered in `main.rs`
- `api.js`: `paperNeighbors()` and `paperRelationsBuild()` wrappers
- `init_schema` now pre-creates `paper_gaps` table with `(id, topic, kind, title, detail_json, evidence_post_ids_json, score, created_at)` + index on `(topic, kind)`

## Files Created

- `src/gapmap/research/sources.py`
- `src/gapmap/research/paper_relations.py`
- `tests/test_paper_sources.py`
- `tests/test_paper_neighbors.py`
- `tests/test_paper_relations.py`
- `tests/test_paper_gaps_schema.py`

## Files Modified

- `src/gapmap/research/paper_chunks.py` — academic-source guard in `chunk_paper`
- `src/gapmap/retrieval/palace.py` — added `paper_neighbors` after `search_papers`
- `src/gapmap/cli/main.py` — two new `research_app` commands after `paper-stats`
- `src/gapmap/core/db.py` — `paper_gaps` table in `init_schema`
- `app-tauri/src-tauri/src/commands.rs` — `paper_neighbors` + `paper_relations_build` commands
- `app-tauri/src-tauri/src/main.rs` — registered in `generate_handler![]`
- `app-tauri/src/api.js` — `paperNeighbors` + `paperRelationsBuild`
