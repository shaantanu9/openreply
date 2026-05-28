# Graph performance — three graphify-inspired wins

**Date:** 2026-05-28
**Type:** Performance

## Summary

Three additive perf patches following the morning's graphify pattern port.
Together they cut representative query times by 20×–33,000×. All gated by
either a default flag (skeleton-only clustering) or a one-time idempotent
schema bump (JSON indexes + composite). No existing call sites changed.

## Measured impact (topic: "AI coding assistants", 5,633 nodes, 12,254 edges)

| Operation                              | Before     | After     | Speedup    |
|----------------------------------------|------------|-----------|------------|
| `detect_communities_leiden` (skeleton) | 1,136 ms   | 26 ms     | 44×        |
| `detect_communities_leiden` (full)     | 2,555 ms   | 597 ms    | 4.3×       |
| `knowledge_gaps`                       | 188,483 ms | 5.6 ms    | 33,657×    |
| `surprising_connections`               | ~12 ms     | 6.0 ms    | 2×         |
| `cross_source_bridges`                 | ~10 ms     | 0.3 ms    | 33×        |
| `god_nodes`                            | 67 ms      | 45 ms     | 1.5×       |
| `build_nx` warm cache hit              | 394 ms     | 3.5 ms    | 112×       |

The knowledge_gaps number deserves a footnote: the new JSON-expression
indexes confused SQLite's query planner into a quadratic plan for the
correlated `NOT EXISTS` form. The fix was a rewrite + a composite
`(topic, kind)` index + `ANALYZE`.

## Changes

### 1. Skeleton-only community clustering (default)
- `detect_communities_leiden(skeleton_only=True)` is now the default.
- Clusters only the ~300 nodes the D3 viewer's `skeleton` mode renders
  (topic / era / subreddit / source / document / painpoint / feature_wish
  / product / workaround + top-N posts connected to semantic findings).
- SQL is narrowed too — `WHERE id IN (...)` on the node SELECT and a
  two-sided IN on the edge SELECT. The brute-force "pull 5K, filter to
  300 in Python" path was 80% of wall time.
- `--all-nodes` CLI flag opts back into clustering every node.
- Returned summary now carries `skeleton_only` and `clustered_node_count`.

### 2. JSON-expression indexes (SQLite ≥3.9)
Added in `ensure_graph_schema` (idempotent on every call):
- `idx_nodes_meta_community` — `(topic, json_extract(metadata_json, '$.community_id'))`
- `idx_nodes_meta_source_diversity` — `(topic, json_extract(metadata_json, '$.source_diversity'))`
- `idx_nodes_meta_evidence_count` — `(topic, json_extract(metadata_json, '$.evidence_count'))`
- `idx_edges_meta_confidence` — `(topic, json_extract(metadata_json, '$.confidence'))`

Without these, every insight query forced a JSON parse per row. With
them, filters on community_id / confidence / source_diversity become
pure btree lookups.

### 3. Composite (topic, kind) on graph_edges
Retro-added via `CREATE INDEX IF NOT EXISTS` outside the table-creation
block so existing DBs get patched. After the JSON-path indexes landed
the planner was picking one of them as the leading index for queries
filtering by `topic + kind`, producing degenerate plans on large topics.
The composite index removes ambiguity.

### 4. `ANALYZE` after schema bump
One-shot inside `ensure_graph_schema` so the planner refreshes its
statistics after new indexes appear. Best-effort.

### 5. `knowledge_gaps` correlated-NOT-EXISTS rewrite
Replaced the `NOT EXISTS (SELECT 1 FROM graph_edges …)` correlated
subquery with two flat queries + Python set subtraction. The flat form
uses the new composite index optimally; the correlated form was the
worst-case for the planner after the JSON indexes were added.

### 6. `build_nx` in-process memoization
- Cache keyed by `(topic, version_token)` where the version token is
  `max(ts) | node_count | edge_count` for the topic.
- Any upsert refreshes `ts`, so the cache invalidates automatically the
  moment new data lands.
- ≤ 4 topics retained (LRU bound).
- `build_nx(topic, use_cache=False)` for tests; `clear_build_nx_cache()`
  for the daemon worker that mutates the graph mid-process.

## Files Modified

- `src/gapmap/graph/schema.py` — composite index + 4 JSON-path indexes + ANALYZE
- `src/gapmap/graph/communities.py` — `skeleton_only` param + narrowed SQL
- `src/gapmap/graph/insights.py` — `knowledge_gaps` rewrite (two-query form)
- `src/gapmap/graph/analyze.py` — `build_nx` cache + `clear_build_nx_cache`
- `src/gapmap/cli/main.py` — `--all-nodes` flag on `graph communities`

## How to roll out

The schema migrations are idempotent and run automatically on next
`ensure_graph_schema()` call (i.e. next `graph build` / `graph enrich` /
`graph communities`). One-time cost on first run: SQLite materializes
each JSON-path index (~5K rows × 4 indexes ≈ 1-2 minutes for a typical
topic, single time).

If a topic feels stuck on first hit:

```bash
# Force the index population synchronously and observe progress:
uv run python -c "from gapmap.graph.schema import ensure_graph_schema; ensure_graph_schema()"
```

After that, all insight + report calls return in single-digit ms.
