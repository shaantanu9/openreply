# Daemon lock timeout — long LLM jobs no longer freeze every other tab

**Date:** 2026-05-28
**Type:** Fix (architecture)

## Summary

Every `run_cli` invocation routed through one of two tokio Mutexes (`dev_daemon_slot()` and `sidecar_daemon_slot()` in `app-tauri/src-tauri/src/cli.rs`) — one slot per daemon, one in-flight request at a time, all the way to the Python sidecar. A long LLM job (sentiment-by-source, audience-build, concepts, run_monitor) would hold that mutex for 30-90 seconds while every other UI query — Settings card refreshes, BYOK probes, topic-list updates, sidebar counts — silently queued behind it. The whole app felt frozen even though only one operation was actually working.

`run_query` is the lone exception: it opens SQLite directly in rusqlite (`commands.rs:4145`) and never touches the daemon. That's why purely DB-backed tabs (Activity, Find, Search, Database) felt snappy while LLM tabs felt dead. The new sentiment live-polling fix relied on this property.

Fix: wrap the `slot.lock()` call in both `run_via_dev_daemon` and `run_via_sidecar_daemon` with `tokio::time::timeout`. If the lock is contended past the timeout, return `DaemonOutcome::DaemonBroken("lock contention …")` — `run_cli` already handles that outcome by falling through to the one-shot `run_dev_python_cli` / `build_sidecar_cmd().output()` paths. Net effect: a UI query never waits more than 3 seconds (dev) / 6 seconds (prod) for the warm daemon before getting its own ephemeral Python process. The long LLM job keeps running undisturbed on the daemon; small queries no longer starve.

## Why those timeout values

- **Dev (3s)** — `.venv/bin/python` one-shot spawn is ~200ms. The wait-vs-spawn break-even point is small.
- **Prod (6s)** — bundled PyInstaller one-shot spawn pays macOS Gatekeeper verification + Python boot tax (~2-5s). Higher break-even, so we wait a bit longer for the warm daemon before paying that price.

## Changes

- Added `DAEMON_LOCK_TIMEOUT_DEV_SECS = 3` and `DAEMON_LOCK_TIMEOUT_PROD_SECS = 6` constants in `app-tauri/src-tauri/src/cli.rs`.
- Wrapped the lock acquisition in `run_via_dev_daemon` (`cli.rs:241`) with `tokio::time::timeout`; on timeout, returns `DaemonOutcome::DaemonBroken("lock contention >3s — falling back to one-shot")`.
- Same pattern for `run_via_sidecar_daemon` (`cli.rs:411`) with the 6-second prod timeout.

## Verified

- `cargo check` — 0 errors, 1 (pre-existing JWT) warning.

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — daemon lock timeouts in both dev and bundled paths.

## Follow-ups (not in this changeset)

- Long LLM jobs (sentiment, audience-build, concepts, run_monitor) still pin the daemon while they run. If two of them ever overlap (e.g. user clicks Audience while sentiment is running), the second one falls back to one-shot — which is a fresh Python process per call. Not ideal but not broken; the operations are serialized at the Python level too (Ollama / API rate limits), so concurrent LLM jobs were never the goal. The real next step for these would be routing them through `run_cli_streaming` so they spawn their own short-lived process and never touch the daemon at all.
- Apply the sentiment-style "kick LLM job + poll SQLite for incremental DB writes" pattern to other tabs whose Python implementation persists rows during the run. Sentiment was the highest-impact target; audience clustering and intent-ladder are the obvious next candidates.
