# Live-data layer — DB mtime polling + visibility-aware auto-refresh

**Date:** 2026-04-19
**Type:** Feature + Fix (freshness / live data)

## Summary

The cache layer kept repeat navigation fast, but **external writes** (background collect in another window, MCP server clients, manual `reddit-cli` invocations from terminal) could leave stale data on screen until the user manually refreshed. Added a cheap `db_mtime` Rust command (single stat syscall — no Python spawn) that the frontend polls every 5 s while the document is visible. When the SQLite file's modified-time changes externally, `api.js` clears its cache and fires a `openreply:db-changed` window event; Dashboard + Activity screens listen and silently re-fetch. Result: data is always fresh *and* still fast — the 5 s / 10 s / 30 s TTLs get overridden immediately on any real external change.

Plus: Dashboard now has a 30 s belt-and-braces background refresh interval (only while the window is visible) that covers intra-app writes that don't quite trip the mtime poller's window.

## Changes

### Rust — new `db_mtime` command
- `commands.rs::db_mtime` — `std::fs::metadata(dir/reddit.db).modified()` → unix milliseconds. Returns 0 when the DB hasn't been created yet. No Python involved.
- Registered in `main.rs::invoke_handler`.

### JS — freshness poller in `api.js`
- New `startFreshnessPoller()` runs on module load (deferred one tick). Calls `db_mtime` every 5 s while `document.visibilityState === 'visible'`; also fires an immediate poll whenever the tab regains focus (covers "alt-tab back after running the CLI" in <100 ms).
- First observation primes `_lastMtime` without triggering invalidation; subsequent changes call `clearApiCache()` and dispatch a `openreply:db-changed` CustomEvent with the new mtime.
- `api.dbMtime()` exposed for any screen that wants direct access; uses plain `invoke` (never cached — a cached mtime would defeat the purpose).

### Screens — live refresh hooks
- `home.js` — on mount, subscribes to `openreply:db-changed` AND sets a 30 s `setInterval` (visible-only). Both fire `loadHeroAndStats / loadMomentum / loadActivity / loadTopicGrid / loadActiveCollect`. Cleanup on `routeGen` change or `root.isConnected === false`.
- `activity.js` — on mount, subscribes to `openreply:db-changed` → re-runs `loadPage / loadSpark / checkLive`. Cleanup on `hashchange`.

### Roadmap bookkeeping
- `docs/openreply-roadmap.md` — ticked "DB-mtime freshness poll" + "Visibility-aware live refresh" under a new "Live-data layer" subsection; elaborated the deferred "Persistent Python subprocess" item with approach + failure modes + honest "2–3 h, next session" note.

## Expected impact

| Scenario | Before | After |
|---|---|---|
| Cached read within TTL | Instant | Instant (unchanged) |
| External write + user on Dashboard | Stale until manual refresh | Auto-refresh within ≤ 5 s |
| User alt-tabs back into OpenReply after CLI | Up to 30 s stale (TTL) | Fresh within <100 ms |
| Browser hidden | Polling paused (battery-friendly) | Polling paused |
| Transient sidecar error | Would propagate | Retried once with 500 ms backoff (from prev change) |

## Not in this commit (explicitly deferred)

- **Persistent Python subprocess** — the 10× cold-path win. Deserves its own PR with failure-mode testing. Scoped in the roadmap: mutex-serialised request/response to a long-lived Python daemon (`cli/daemon.py`); one-shot spawn remains the fallback.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — new `db_mtime` command
- `app-tauri/src-tauri/src/main.rs` — register `db_mtime`
- `app-tauri/src/api.js` — `dbMtime()` binding + `startFreshnessPoller()` + `openreply:db-changed` event
- `app-tauri/src/screens/home.js` — live-refresh listener + 30 s visible-only interval
- `app-tauri/src/screens/activity.js` — live-refresh listener
- `docs/openreply-roadmap.md` — tracking updates
