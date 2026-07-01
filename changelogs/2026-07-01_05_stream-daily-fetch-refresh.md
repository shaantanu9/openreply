# Fix: "Refresh + learn" (daily fetch) timed out in the UI — make it streaming

**Date:** 2026-07-01
**Type:** Fix

## Summary

Even after the `init_schema` contention fix, the Overview **"Refresh + learn"**
button still showed a spinner and then "nothing new". Root cause is separate and
architectural: a refresh runs a **multi-source `collect` (each source 30–240s)
plus a learning pass** — measured at **7+ minutes** for the active agent (703
posts across 23 sources; `reddit_free` 153s, `youtube` timed out at 240s). But
`agent_refresh` used the **blocking** `run_cli` path, capped by the daemon /
one-shot IPC timeout of **120s** (and the frontend's 360s). So the call was
always killed mid-fetch → dead spinner, no visible result.

## Fix

Converted "Refresh + learn" to the same **streaming** pattern already used by
"Find opportunities" (`run_cli_streaming`), which is not timeout-bound and emits
live progress:

- **CLI** (`agent_cmds.py`): `agent refresh --stream` emits NDJSON progress
  lines to stdout (mirrors `reply find --stream`); collect/learn progress
  strings are wrapped as `{"event":"log","msg":…}`, ending with a `result` event.
- **Rust** (`commands.rs`): new `agent_refresh_stream` command using
  `run_cli_streaming` with `agent_refresh:progress` / `agent_refresh:done`
  events; registered in `main.rs`.
- **Frontend** (`api.js`, `dynamic.js`): `agentRefreshStream` + the `#ov-refresh`
  handler now subscribes to progress/done (showing the current source in the
  button tooltip) and reloads the Overview on `done`. Falls back to the blocking
  `agentRefresh` in a plain browser / older shell.

## Verification

- `agent refresh --stream` emits valid NDJSON (32/32 lines valid in an 18s slice).
- `cargo check` clean with the new command registered.
- Python syntax check clean.

## Files Modified

- `src/openreply/cli/agent_cmds.py` — `refresh_cmd` gains `--stream`.
- `app-tauri/src-tauri/src/commands.rs` — `agent_refresh_stream`.
- `app-tauri/src-tauri/src/main.rs` — register `agent_refresh_stream`.
- `app-tauri/src/or/api.js` — `agentRefreshStream`.
- `app-tauri/src/or/dynamic.js` — `#ov-refresh` uses the streaming path.

## Note

Compose "Run now" (`autopilot-run`) called the same `find_opportunities` that was
hanging, so it was broken by the `init_schema` bug too; with that fixed it now
completes in ~90s (< the 120s cap). Verified separately.
