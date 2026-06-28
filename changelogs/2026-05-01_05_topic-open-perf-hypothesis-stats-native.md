# Topic-open perf — hypothesis_stats off the sidecar

**Date:** 2026-05-01
**Type:** Fix

## Summary

Opening any topic was slow even though "the data is already in the local DB" because the topic page fired several Python-sidecar invocations in parallel (Bets pill, saturation, coverage gaps, byok status). Each `run_cli` is a fresh `tokio::process::Command::output()` — no warm process — so every call paid PyInstaller / Python interpreter startup (~300–800 ms warm, 1–2 s cold on bundled DMG). This first patch eliminates the Bets-pill spawn by routing `api.hypothesisStats` through the native `run_query` SQLite path that already runs sub-10 ms in `spawn_blocking`.

## Changes

- Added `cachedFetch(key, fetcher, ttlMs)` next to `cachedInvoke` so we can dedup + TTL arbitrary async work, not just `invoke()` calls.
- Rewrote `api.hypothesisStats(topic)` to run `SELECT status, count(*) FROM hypothesis_tests WHERE topic=:topic AND status!='archived' GROUP BY status` (or the global variant when `topic` is null) through `invoke('run_query', …)` and reshape rows into the existing `{ ok, topic, stats }` contract. Cache key kept as `hypothesis_stats:${topic}` so `mutated('hypothesis')` (INVALIDATE_MAP['hypothesis']) still invalidates via the existing prefix-match. TTL bumped 5 s → 60 s because bets only change on explicit user action.
- Existing callers (home.js dashboard "My bets" card, topic.js Bets pill, topic.js Bets-tab freshness badge) unchanged — same return shape.
- Rust `hypothesis_stats` Tauri command and Python `research hypothesis-stats` CLI left in place for MCP / other non-UI callers.

## Files Modified

- `app-tauri/src/api.js` — added `cachedFetch`, rewrote `hypothesisStats` to use native `run_query`.
