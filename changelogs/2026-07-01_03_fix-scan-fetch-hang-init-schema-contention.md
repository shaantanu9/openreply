# Fix: Daily Fetch / Opportunity Scan produced nothing new (init_schema lock contention)

**Date:** 2026-07-01
**Type:** Fix

## Summary

"Refresh + learn" (daily fetch), "Find opportunities" (opportunity scan),
Compose "Run now", and the daily-cadence auto-runs all showed a spinner but
then no new posts/opportunities appeared anywhere. Root cause: `init_schema()`
had **no run-once fast-path**, and `credentials.get_credential()` /
`cookie_header()` / `has_credential()` call `init_schema()` on *every*
invocation. During a `reply find` scan that fans out ~17 source adapters plus
N reddit worker threads, every thread re-ran the full schema DDL **including a
write+commit** (the `fetches` zombie-sweep), serializing all of them on
SQLite's single-writer lock. The scan then blew past its 35s/40s time budgets,
never reached the persist step (`reply_opportunities.upsert`), and the UI's
`reply_find:done` event never fired — so the opportunity list never reloaded.

## Root cause (evidence)

- `faulthandler` stack dumps during a live scan showed the main thread stuck in
  `_scan_platforms → _connected_engage → has_credential → get_credential →
  init_schema → _ensure_extraction_queue`, and every reddit worker thread stuck
  in `fetch_reddit_free → cookie_header → get_credential → init_schema`.
- `get_db()` already guards `init_schema` to run once (`_schema_lock` +
  `_schema_inited`), but `credentials.py` bypassed that by calling
  `init_schema(db)` directly, unguarded, after `get_db()`.
- The health check measured a single `init_schema`/DB-open at ~3.6s; multiplied
  across dozens of concurrent credential lookups → the multi-minute hang.

## Fix

Added an early-return fast-path guard at the top of `init_schema()` keyed on the
existing module-global `_schema_inited`. The one-time DDL + migration sweep still
runs once per process (under `get_db()`'s `_schema_lock`); every repeat call
(including all `credentials.*` calls and any future caller) now returns
immediately. The guard only *reads* the flag — `get_db()` holds `_schema_lock`
while calling `init_schema` and sets the flag right after, so `init_schema` must
not take that lock itself (would deadlock a non-reentrant `Lock`).

## Verification

Same scan probe, before vs. after:

- Before: hung >4 min, never returned; `reply_opportunities` stuck at 174 rows,
  `max(found_at)` 12 hours stale.
- After: `find_opportunities` **returned in 50.7s, found=10**; rows 174 → 180
  (6 new), `max(found_at)` = now. Well within the frontend's 6-minute timeout,
  so `reply_find:done` fires and the list reloads.

Also killed the stale dev-python daemon (had the pre-fix code resident in
memory) so the running `tauri dev` app respawns it with the fixed code.

## Files Modified

- `src/openreply/core/db.py` — `init_schema()`: added `if _schema_inited: return`
  fast-path guard + explanatory docstring.

## Known follow-ups (not in this change)

- `app-tauri/src-tauri/src/schedule.rs` — `sidecar_absolute()` returns `None` in
  a packaged (non-dev) build, so `schedule_install` ("daily frequency") fails
  outside dev with "could not resolve sidecar binary path". Also `status()` does
  not return `interval_hours`, so the Settings label always reads "every 24h".
  Needs a Rust rebuild; dev builds are unaffected.
- `posts.fetched_at` has a few legacy `reddit_free` rows stored as epoch strings
  instead of ISO-8601; as a TEXT sort those sink below ISO rows in
  `ORDER BY fetched_at`. Small blast radius (9 rows); current writers use ISO.
