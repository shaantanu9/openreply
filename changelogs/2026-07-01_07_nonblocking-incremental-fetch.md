# Non-Blocking Incremental Daily Fetch (hybrid progress UI)

**Date:** 2026-07-01
**Type:** Feature

## Summary

"Refresh + learn" (daily fetch) is a multi-source `collect` (parallel across ~18
sources, 30–240s each) plus a learning pass — minutes of work. It now runs as a
**streaming background job** with **live, source-by-source progress that survives
navigating between screens**, and the Overview reloads when it lands — without
freezing the rest of the app. Implements sub-project **A** of the daily-automation
roadmap (see `docs/superpowers/specs/2026-07-01-nonblocking-incremental-fetch-design.md`
and the plan in `docs/superpowers/plans/2026-07-01-nonblocking-incremental-fetch.md`).

## Changes

- **Structured progress events** — `agent refresh --stream` now emits structured
  NDJSON (`{"event":"source"|"phase"|"result"|"log", ...}`) via a pure, unit-tested
  mapper (`src/openreply/cli/_progress.py`). The non-stream CLI path still prints
  the original human strings to stderr.
- **`fetchStatus` store** (`app-tauri/src/or/fetchStatus.js`) — a pure, node-tested
  reducer + pub/sub holding `{running, phase, sources, totalPosts, sourcesDone,
  done, error}`.
- **App-level listener** (`main.js`) — a single boot-time subscription to
  `agent_refresh:progress` / `agent_refresh:done` feeds the store, so progress is
  **not** owned by any screen and survives navigation; dispatches
  `openreply:fetch-done` on completion.
- **Global fetch chip** (`shell.js`) — persistent bottom-right chip
  (`Fetching… N/M · K posts`) with a **Stop** button; subscribes once
  (subscribe-guarded against re-mount).
- **Cancel command** — new `#[tauri::command] cancel_refresh` (wraps
  `cli::cancel_active_stream`) + `api.cancelRefresh`, so Stop can halt a run.
- **Overview inline panel** (`dynamic.js`) — live source-by-source panel
  (✓ count / ✗ skipped / spinner + phase + post total) while running; reloads
  the digest/KPIs on done; Refresh button reflects `running` and no longer owns
  the progress listener; "Find opportunities" is concurrency-aware (blocks with a
  message while a fetch runs). Subscriptions are torn down via the existing
  `view.__orCleanup` portal convention (no leak).
- **Timeouts** — the streaming path has no frontend IPC timeout (event-driven),
  replacing the old 120s/360s ceilings that killed the fetch. Source collection is
  bounded by `OPENREPLY_SOURCE_TIMEOUT_SEC` (default 240s, env-tunable) with
  stragglers abandoned; left at the default since the goal is maximum daily data.

## Files Created

- `src/openreply/cli/_progress.py`, `tests/test_refresh_progress.py`
- `app-tauri/src/or/fetchStatus.js`, `app-tauri/tests/fetch-status.test.mjs`
- `docs/superpowers/specs/2026-07-01-nonblocking-incremental-fetch-design.md`
- `docs/superpowers/plans/2026-07-01-nonblocking-incremental-fetch.md`

## Files Modified

- `src/openreply/cli/agent_cmds.py` — `refresh_cmd --stream` emits structured events.
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — `cancel_refresh` command + registration.
- `app-tauri/src/main.js` — app-level progress listener.
- `app-tauri/src/or/api.js` — `agentRefreshStream` (earlier) + `cancelRefresh`.
- `app-tauri/src/or/shell.js` — global fetch chip.
- `app-tauri/src/or/dynamic.js` — Overview inline panel, concurrency-aware actions, streaming Refresh handler, `__orCleanup` teardown.

## Follow-ups (later sub-projects)

- **B** — add more source adapters (reply + learning breadth).
- **C** — auth-gated connections (X / LinkedIn / more) via Reach Connections.
- **D** — continuous learning + memory-palace evolution.
