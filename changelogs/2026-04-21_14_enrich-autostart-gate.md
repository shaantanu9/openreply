# Auto-start extraction worker at 100-post threshold

**Date:** 2026-04-21
**Type:** Feature

## Summary

Task 6 of the incremental-enrichment plan. The Rust supervisor now auto-starts the long-lived Python extraction worker on app boot if any topic already has ≥ 100 rows in `topic_posts`, and again after any collect finishes (in case the collect just crossed the threshold). Below-threshold installs stay idle until the first large collect completes, so fresh users don't pay for a Python daemon until there's signal to extract.

## Changes

- Added `worker::ENRICH_THRESHOLD: u64 = 100` constant, exported for reuse.
- New `.setup()` handler in `main.rs` that runs a non-blocking async task: queries `reddit.db` via native `rusqlite` (`crate::db::query_db`) for `SELECT COALESCE(MAX(c), 0) FROM (SELECT count(*) c FROM topic_posts GROUP BY topic)` and calls `worker::start_worker(app)` when the max meets the threshold. Uses `tokio::task::spawn_blocking` to keep the sync SQLite call off the async runtime, and guards against missing DB (fresh install) with an early return.
- Wired `api.startExtractionWorker` / `stopExtractionWorker` / `extractionWorkerStatus` methods in `app-tauri/src/api.js`.
- `main.js` listens for `openreply:changed` kind='collect' and fires `api.startExtractionWorker().catch(() => {})` — idempotent on the Rust side so rapid collect completions don't stack.
- Verified the existing `ExitRequested`/`Exit` handler in `main.rs` still calls `worker::stop_worker_blocking(app_handle)` from Task 5 (line 238) so the Python daemon is SIGTERM'd on app quit, not orphaned.
- `cargo check` passes cleanly (no warnings).

## Files Modified

- `app-tauri/src-tauri/src/main.rs` — added `.setup()` handler with boot-gate query
- `app-tauri/src-tauri/src/worker.rs` — added `ENRICH_THRESHOLD` public constant
- `app-tauri/src/api.js` — new extraction-worker command wrappers
- `app-tauri/src/main.js` — collect:done → `startExtractionWorker()` hook
