# Centralized SQLite write-retry to eliminate "database is locked"

**Date:** 2026-06-30
**Type:** Fix

## Summary

The core layer (collect / posts / comments / graph) already wrapped its SQLite
writes in `_retry_on_locked` (WAL + 15s `busy_timeout` + exponential-backoff
retry). The **reply/agent layer did not** — roughly 40 raw
`db["x"].upsert/insert/update/delete(...)` call sites across
`agent`, `opportunity`, `generate`, `notify`, `digest`, `relevance`,
`feedback`, `content`, `geo`, `playbook`, `poster`, `scheduler`, … hit SQLite
directly with no retry. With the Telegram bot poller and the `schedule-tick`
daemon (both added today) now writing concurrently alongside the Tauri sidecar
and the enrich worker, those unwrapped writes were the realistic source of
`OperationalError: database is locked` surfacing to the UI.

Rather than touch every call site (easy to miss one, easy to regress), the fix
wraps the sqlite-utils `Table` write **primitives** once at import time, so
every write in the app — present and future, core and reply — inherits the same
retry safety net.

## Changes

- Made `_retry_on_locked` **re-entrant** via a thread-local guard
  (`_retry_active`). Only the outermost call owns the retry loop; nested calls
  execute the function exactly once. This prevents attempt-count multiplication
  (e.g. `upsert → upsert_all → insert_all`, or an explicit
  `_retry_on_locked(insert_all, …)` whose target is itself wrapped).
- Added `_install_write_retry()` (called once at module import) that
  monkeypatches the sqlite-utils `Table` write leaves —
  `insert_all`, `update`, `delete`, `delete_where` — to route through
  `_retry_on_locked`. `insert` / `upsert` / `upsert_all` all funnel through
  `insert_all`, so wrapping that leaf alone covers them with a single retry
  layer (no nesting). `update` / `delete` / `delete_where` go straight to
  `db.execute`, so they are wrapped directly.
- Idempotent install (guarded by `_write_retry_installed` and a per-method
  `_openreply_retry` marker) — safe across re-imports.

## Verification

- **Lock contention:** an exclusive WAL write lock held 1.2s past the (lowered)
  300ms `busy_timeout` — a patched `upsert` waited 1.25s and succeeded instead
  of raising "database is locked".
- **Re-entrancy:** under a permanently-locked fn with `attempts=4`, an explicit
  `_retry_on_locked` wrapping a wrapped method invoked the underlying fn exactly
  4 times (not 16) — confirming no nesting explosion.
- **Reply layer:** `reply_notified` / `reply_state` upsert + update through the
  patched path succeed end-to-end.

## Files Modified

- `src/openreply/core/db.py`
  - `_retry_on_locked` — added thread-local re-entrancy guard.
  - Added `_retry_active`, `_write_retry_installed`, `_install_write_retry()`
    and the import-time install call.
