# MCP tool resilience — schema fixes, HNSW + WAL self-heal, search fallbacks

**Date:** 2026-05-02
**Type:** Fix

## Summary

Six MCP tools were failing with bugs that should never reach the user
again — schema-shape mismatches, corrupt index crashes that survive
across sessions, and timeouts that killed the whole MCP transport. Each
failure mode is now fixed at the source so the same problem can't recur:

1. `gapmap_synthesize_insights` — output validation error: the LLM
   sometimes returned a shape that didn't match the declared schema.
2. `gapmap_semantic_search` — "Failed to apply logs to the hnsw segment
   writer" once the on-disk vector index got corrupted (typically after
   a hard kill mid-write) — every subsequent call kept failing forever.
3. `gapmap_search_all` (normal) — 0 hits for natural-language phrases
   because LIKE only matches verbatim substrings.
4. `gapmap_search_all` (aggressive) — connection closed when the LLM
   query-expansion or the corrupt palace search hung past the MCP
   transport idle window.
5. `gapmap_global_competitors` — schema mismatch (return type was
   declared `list[dict]` but the implementation returned a `dict`).
6. `gapmap_query_db` — knock-on `database is locked` / `disk I/O error`
   after the HNSW writer crashed and left the SQLite WAL in a bad state.

## Changes

- **`gapmap_synthesize_insights`** wraps the call in try/except and
  normalizes the response so the dict always has `{ok, topic, findings,
  ...}` regardless of which path produced it. Hoists `findings` from
  nested `report` so MCP clients don't have to introspect.
- **`gapmap_global_competitors`** signature changed from `list[dict]`
  to `dict`. Wrapper also accepts both legacy-list and current-dict
  return shapes from the implementation and coerces to a stable
  `{ok, competitors[], clusters_returned, threshold, min_topics}`.
- **`palace.heal_corrupt_index()`** — new helper that detects HNSW
  corruption markers ("failed to apply logs", "hnsw segment writer",
  "InvalidArgumentError: HNSW", etc.), drops the cached client, moves
  the on-disk palace dir to a `.corrupt_backup_<ts>` sibling, and lets
  the next `get_palace()` rebuild a fresh empty store. The corpus is
  safe — palace is a derived index over `posts`/`topic_posts`.
- **`palace.search_posts()`** auto-runs the heal on HNSW errors and
  retries once. Returns `{ok:True, results:[], healed:True,
  hint:"run reindex_all()"}` on the retry path so callers degrade
  gracefully instead of crashing.
- **`gapmap_palace_repair`** — new MCP tool exposing the heal +
  optional re-index from outside. Lets a user (or agent) trigger
  "fix my semantic search" in one call instead of doing the manual
  rm/sqlite-cli dance.
- **`search_all` (normal)** now also splits the query into
  `_significant_tokens()` (drops stop-words + 1-char fragments) and
  unions LIKE hits across each token, so a multi-word query like
  "collect freezes after upgrade" surfaces posts mentioning either
  "freezes" or "upgrade" instead of returning 0.
- **`search_all` (aggressive)** wraps `_expand_query_with_llm` in a
  12s `concurrent.futures` timeout and `_palace_hits` in an 8s timeout.
  A hung LLM call or a slow-warmup ONNX no longer kills the MCP
  transport; aggressive mode degrades to "normal + token fallback".
- **`db._wal_self_heal()`** — new boot-time helper invoked from
  `get_db()` once per process. Tries `PRAGMA wal_checkpoint(TRUNCATE)`
  + `PRAGMA quick_check`; falls back to removing `*-wal`, `*-shm`,
  `*-journal` sidecar files when the checkpoint can't run. Idempotent
  via a module-level guard so healthy DBs pay no measurable cost.
- **`gapmap_query_db`** retries once on `database is locked` /
  `disk I/O error`, then forces a fresh per-thread DB handle so a
  stuck cursor can't keep tripping subsequent calls.

## Files Modified

- `src/reddit_research/mcp/server.py`
  - `gapmap_synthesize_insights` — try/except + response normalisation
  - `gapmap_global_competitors` — return type fixed to `dict`, robust
    wrapper handles list / dict / exception cases
  - `gapmap_query_db` — retry on transient lock + cache-clear on hard
    failure
  - `gapmap_palace_repair` — new tool

- `src/reddit_research/retrieval/palace.py`
  - `_HNSW_ERROR_MARKERS`, `_looks_like_hnsw_corruption()`,
    `heal_corrupt_index()` — new
  - `search_posts` — auto-heal + retry on HNSW errors

- `src/reddit_research/research/search_all.py`
  - `_significant_tokens()` — new token-fallback helper
  - `_palace_hits()` — 8s timeout, returns `[]` on hang
  - `search_all` — wraps LLM expansion in 12s timeout, fans out token
    fallback queries

- `src/reddit_research/core/db.py`
  - `_wal_self_heal()` — new
  - `get_db()` — calls `_wal_self_heal()` before opening connection
