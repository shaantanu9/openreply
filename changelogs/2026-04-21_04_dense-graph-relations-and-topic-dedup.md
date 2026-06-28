# Dense graph relations (semantic + co-evidence) + topic-canonicalize dedup

**Date:** 2026-04-21
**Type:** Feature + Fix

## Summary

Two related fixes that make the openreply-map graph form proper, logical connections
and prevent duplicate topic rows from the LLM canonicalization step.

### 1. Dense graph relations (feature)

The old graph was a tree: `topic → finding → post`. Findings never connected
to each other, so users saw disconnected islands — a painpoint about
"hallucinates facts" didn't link to a feature_wish "better grounding" or a
workaround "RAG with sources" unless the LLM happened to name the same
string in `gap`. Reports of "1.8k posts but graph has no connections" all
traced to this.

Shipped a post-pass that uses the ChromaDB MiniLM ONNX embedder (the same
one `cluster.py` already uses for dedup) to create four new edge kinds:

- **`relates_to`** — any two findings with cosine ≥ 0.55. Weight = similarity.
- **`potentially_solves`** — workaround ↔ painpoint with cosine ≥ 0.50.
  Replaces the brittle exact-string `gap` match.
- **`could_address`** — feature_wish ↔ painpoint ≥ 0.50.
- **`co_evidenced`** — two findings sharing ≥2 evidence posts. Structural
  signal, independent of label similarity — catches cases where embedding
  misses (e.g. "latency" vs "UX feels slow", same Reddit thread).

Hairball prevention: per-node neighbor cap (top-N by similarity, default 8).
One popular finding can't dominate with 30+ edges.

Tuning envs:
- `OPENREPLY_REL_THRESHOLD` (default 0.55) — relates_to cutoff
- `OPENREPLY_SOLVE_THRESHOLD` (default 0.50) — cross-kind solve/address cutoff
- `OPENREPLY_REL_MAX_NEIGHBORS` (default 8) — per-node fanout cap

Graceful skip when ChromaDB isn't installed — graph stays functional
(structural tree still built), just without the dense semantic layer.

Hooked into two places so both paths auto-densify:
- `upsert_semantic` tail — every enrich run builds relations
- `build_structural` tail — "Rebuild graph" button also rebuilds relations
  when ≥2 semantic nodes exist (no LLM re-run needed)

### 2. Topic canonicalize dedup (fix)

Before: when the LLM rewrote `calari tracking` → `calorie tracking`,
`collect.py` inserted the original string into `topic_prefs` up-front for
instant UI feedback, then inserted the canonical as a second row. Result:
two topics on the Dashboard — one real with data, one phantom with 0 posts.

Fix: after canonicalize, DELETE the original typed row from `topic_prefs`
before inserting the canonical. Guarded by a count check — only delete if
the original has 0 tagged posts (defensive, never destroy real data).

### 3. Home page hero/stat-grid shape fix (fix)

`api.overviewStats()` was previously an array of rows but is now a single
object (Rust unwraps first row). `loadHeroAndStats` still checked
`Array.isArray(sRes) && sRes[0]` which always failed → empty stats. Fixed
to tolerate both shapes.

## Changes

### New files
- `src/reddit_research/graph/relations.py` — `build_semantic_relations(topic)`:
  embed all semantic nodes, compute pairwise cosine, write 4 new edge kinds
  with per-node neighbor cap. Env-tunable thresholds. Graceful chromadb-
  missing skip.

### Modified files
- `src/reddit_research/graph/semantic.py` — `upsert_semantic` calls
  `build_semantic_relations` at tail; summary dict now includes
  `relates_to_edges` / `co_evidenced_edges` / `semantic_relations_skipped`
- `src/reddit_research/graph/build.py` — `build_structural` also calls
  `build_semantic_relations` when ≥2 semantic nodes exist, so rebuilding
  the graph without re-running LLM extraction still densifies edges
- `src/reddit_research/research/collect.py` — delete typo topic_prefs row
  when canonicalize rewrites the topic (defensive: only if 0 posts tagged)
- `app-tauri/src/screens/home.js` — `loadHeroAndStats` now tolerates both
  array-of-rows and plain-object shapes from `overview_stats`

## Files Created

- `src/reddit_research/graph/relations.py`
- `changelogs/2026-04-21_04_dense-graph-relations-and-topic-dedup.md`

## Files Modified

- `src/reddit_research/graph/semantic.py`
- `src/reddit_research/graph/build.py`
- `src/reddit_research/research/collect.py`
- `app-tauri/src/screens/home.js`
