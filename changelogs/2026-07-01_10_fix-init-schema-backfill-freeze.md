# Fix 15-24s app freeze: gate the extraction-queue backfill to run once

**Date:** 2026-07-01
**Type:** Fix / Performance

## Summary

Every screen that reads the DB (Overview, Knowledge, chat) took **15-24s** to
load on a mature corpus, and one-shot sidecar calls logged
`dev-python OK in 21381ms`. Root cause: `init_schema()` — which runs once per
process on the first DB access, i.e. in **every** command including read-only
UI reads — called `_ensure_extraction_queue()`, whose backfill
`INSERT OR IGNORE INTO extraction_queue SELECT … FROM topic_posts LEFT JOIN
graph_nodes …` re-ran on every startup. That LEFT JOIN is
O(topic_posts × nodes/topic); after the knowledge graph grew to ~24k nodes /
18.6k topic_posts it cost ~22s of CPU **per process launch**. `INSERT OR
IGNORE` made the insert cheap but the expensive SELECT scan ran regardless.

New posts are already enqueued incrementally by `collect`/`ingest`
(`research/collect.py:299`), so the startup backfill is only a one-time
migration for posts that predate incremental enrichment. Fix: gate it on
`PRAGMA user_version` (previously unused) — run once, stamp the version, and
skip the scan on every later boot (a single-integer read, no lock, instant).
Also added a composite `graph_nodes(evidence_post_id, topic)` index so the
one-time JOIN seeks by the selective column instead of scanning every node in
a topic.

## Changes

- `_ensure_extraction_queue()` (`core/db.py`): early-return when
  `PRAGMA user_version >= 1`; on the one-time path create the composite index,
  run the backfill, then stamp `user_version = 1` only after a clean run (a
  failure retries next launch rather than skipping forever).
- Read-first zombie-sweep (from the prior changelog) retained — it removed the
  other unconditional write on the read path.
- Stamped `user_version = 1` + created `idx_graph_nodes_evidence_topic` on the
  live app DB so the current install skips the one-time scan immediately (the
  queue was already fully populated — 18,595 rows — by prior runs).

## Verification

- `agent get`: **15-24s → 1.79s cold / 0.42s warm**.
- `agent knowledge`: **→ 1.57s**, still returns correct counts (posts 8629,
  graph_nodes 16637).
- `python -m py_compile src/openreply/core/db.py` → OK.

## Files Modified

- `src/openreply/core/db.py` — `_ensure_extraction_queue()` one-time gate +
  composite index.
