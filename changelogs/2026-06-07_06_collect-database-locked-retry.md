# Fix "database is locked" on parallel external-source collection

**Date:** 2026-06-07
**Type:** Fix

## Summary

During a multi-source collect, sources such as HN, App Store, Product Hunt, and
Trustpilot intermittently failed with `source:<name>: database is locked`,
collecting **0 rows** for that source on the run. Root cause: every external
source adapter runs in a worker thread and writes to the same `gapmap.db`
(fetch-audit row → `posts` → `topic_posts`). SQLite — even in WAL mode — permits
exactly one writer at a time; under the recently-widened source worker pool (and
when a second process such as the MCP server / Tauri sidecar / enrich worker is
also attached), a writer could be held past the 5s `busy_timeout`, raising
`database is locked`. Because each adapter calls `log_fetch_start()` *before* its
`try/except`, that lock error escaped the adapter and aborted the whole source.

Fixed by (1) raising the `busy_timeout` 5000 → 15000 ms (env-tunable),
(2) adding a `_retry_on_locked` exponential-backoff wrapper around every DB write,
and (3) making the audit-log writes (`log_fetch_start`/`log_fetch_end`) non-fatal
so a transient lock can never kill a real data fetch — `log_fetch_start` returns a
`-1` sentinel on persistent failure and `log_fetch_end(-1, …)` is a no-op.

The separate `reddit_not_connected` flag in the same log was confirmed **benign**
— it is the deliberate "Reddit API credentials not configured, skipping Reddit"
notice, not a failure.

## Changes

- `PRAGMA busy_timeout` raised 5000 → 15000 ms, now read from
  `GAPMAP_DB_BUSY_TIMEOUT_MS` (default 15000, floor 1000).
- New `_retry_on_locked(fn, *args, **kwargs)` helper + `_is_locked_err(e)`
  classifier in `core/db.py`. Retries on transient lock/busy/disk-I/O errors with
  exponential backoff (`GAPMAP_DB_RETRY_ATTEMPTS`, default 5; base 0.2s, cap 2.0s).
  Re-raises non-lock errors immediately and the lock error after exhaustion.
- `log_fetch_start` now retries and returns `-1` instead of raising when the
  (non-critical) audit write can't complete; `log_fetch_end` no-ops on `fid < 0`.
- `upsert_posts`, `upsert_comments`, and `_tag_posts`' `topic_posts` +
  `extraction_queue` inserts wrapped in `_retry_on_locked`.
- New regression suite `tests/test_db_lock_retry.py` (6 tests): error
  classification, retry-then-succeed, immediate re-raise of non-lock errors,
  re-raise after exhaustion, a real held-write-lock contention scenario, and the
  `-1` sentinel degradation path. All pass; 26 related existing tests still pass.

## Files Created

- `tests/test_db_lock_retry.py`
- `changelogs/2026-06-07_06_collect-database-locked-retry.md`

## Files Modified

- `src/gapmap/core/db.py` — imports (`sqlite3`, `time`, `Callable`/`TypeVar`);
  `_is_locked_err` + `_retry_on_locked`; env-tunable `busy_timeout`; resilient
  `log_fetch_start`/`log_fetch_end`; retry-wrapped `upsert_posts`/`upsert_comments`.
- `src/gapmap/research/collect.py` — import `_retry_on_locked`; wrap the
  `topic_posts` and `extraction_queue` inserts in `_tag_posts`.
