# MCP: venv-binary launch + structured server logger

**Date:** 2026-04-26
**Type:** Fix + Infrastructure

## Summary

The reddit-myind MCP server was failing for the user with "kept losing connection" across all three clients (Claude Code, Claude Desktop, Cursor). Doctor sweep revealed thirteen duplicate `mcp serve` processes racing on the pidfile lock, plus all three configs invoking `uv run` (1-3 s startup overhead per reconnect — Claude Desktop has a ~10 s init timeout, so a slow disk silently exhausted it). Below the connection issue, the server itself had no audit trail: when it crashed before `initialize` completed (slow imports, missing key, lock contention, traceback in tool dispatch) the client just reported "lost connection" with no detail and the user had no way to diagnose.

Two changes ship together:

1. **MCP install path now prefers the venv binary.** When the project has a `.venv/bin/reddit-cli` console script, `mcp install --project-dir <proj>` writes that absolute path as `command` instead of `uv --directory <proj> run reddit-cli mcp serve`. Single-process tree (no uv parent → no orphan child on disconnect), 372 ms startup vs 6-8 s.

2. **Structured server logger with a queryable event store.** New `src/reddit_research/mcp/logger.py` writes every server event (startup phases, lock acquisition / takeover / failure, tool call, tool error, fatal exception) to both `<data_dir>/logs/mcp-server.log` (NDJSON, 3-file rotation at 5 MB) and a new SQLite table `mcp_events` indexed on (ts_epoch, kind, severity, tool_name). Two new CLI commands — `mcp logs` and `mcp stats` — surface the data with severity / kind-prefix / tool / since filters and aggregate views (errors-by-tool, slowest tools, by_severity / by_kind histograms).

After the fix the user can run `reddit-cli mcp stats --since 7d` to see exactly which tools fail most and which exceed client timeouts, then drill in with `reddit-cli mcp logs --tool <name> --severity error --json | jq '.[].details.traceback'` for stack traces.

## Changes

### Phase 1 — Connection fixes (root cause)

- **`src/reddit_research/mcp/install.py`** — `_resolve_command` now checks for `<project_dir>/.venv/bin/reddit-cli` and uses it directly when present. Falls back to absolute-path `uv run` when no venv exists. Comment explains the GUI-launchd-PATH gotcha and the 10 s client-timeout failure mode.
- **Killed 13 duplicate `mcp serve` processes** (`pkill -f "mcp serve"`) — orphans from prior tauri-dev cycles + uv-parent decoupling.
- **Reinstalled all three client configs via `reddit-cli mcp install`** (Claude Code → `~/.claude.json`, Claude Desktop → `~/Library/Application Support/Claude/claude_desktop_config.json`, Cursor → `~/.cursor/mcp.json`). All now point at the venv binary directly. `MCP_TAKEOVER_STALE_LOCK=1` retained in env.

### Phase 2 — Structured logger

- **`src/reddit_research/mcp/logger.py`** (NEW) — module with:
  - `log_event(kind, severity, message, details, tool_name, duration_ms)` — single entry point, dual-writes to file (NDJSON) and SQLite (`mcp_events`). Thread-safe (file + db locks). Best-effort (logger failures swallowed to stderr; never crashes the server it's observing).
  - `read_recent_log(n)` — last N lines from file log.
  - `query_events(kind, kind_prefix, severity, tool_name, since_seconds, limit)` — filtered SQL read with severity ordering (error → returns error AND fatal).
  - `aggregate_stats(since_seconds)` — by_kind / by_severity / top_tool_errors / slow_tools (avg + max duration_ms).
  - `install_unhandled_exception_hook()` — `sys.excepthook` wrapper records `fatal:unhandled` with traceback before stdlib's default handler runs.
  - File log rotation: 5 MB cap, keep `.1` and `.2`.

- **`src/reddit_research/mcp/server.py`** — instrumented:
  - `serve()` calls `install_unhandled_exception_hook()` first, then logs `startup:begin` with full env preview.
  - PID-lock guard logs `startup:lock_acquired` on success or `startup:lock_failed` (severity=error) on refusal.
  - `atexit.register` logs `startup:exit` with uptime.
  - `mcp.run()` wrapped: `startup:ready` before, `fatal:run_loop` (severity=fatal) on non-SystemExit.
  - `mcp.tool` decorator monkey-patched via `_wrap_tool_for_logging` — every existing and future `@mcp.tool()` registration auto-emits `tool_call` events on success (with `duration_ms`, severity=warn if >5 s) and `tool_error` events on exception (with truncated traceback + args preview). All ~90 tools get this for free without per-tool boilerplate.

- **`src/reddit_research/cli/main.py`** — two new commands:
  - `mcp logs --tail N --severity X --kind Y --tool Z --since 24h [--json]` — colour-coded recent events. `--severity error` includes fatal. `--kind` accepts wildcards (`startup:*`, `tool_*`).
  - `mcp stats --since 24h [--json]` — by_severity, by_kind (top 15), top_tool_errors (10), slow_tools (10 by max ms). Since accepts `7d`, `1h`, `30m`, `900` (seconds), or `all`.
  - `_parse_since` helper added at module scope.

- **`mcp_events` SQLite table** — created idempotently by the logger on first write. Schema: `id, ts, ts_epoch, kind, severity, pid, tool_name, duration_ms, message, details_json` + 4 indexes. Lives in the existing `reddit.db` so the desktop app can read it through the same `run_query` channel it already uses for everything else.

### Phase 3 — Doctor script tightened

- **`scripts/mcp_doctor.sh`** smoke-launch step now:
  - Uses a throwaway data dir (avoids polluting the real `mcp_events` table).
  - Feeds `/dev/null` to stdin so FastMCP's `run()` doesn't immediately exit on EOF (false negative we hit during testing).
  - Waits up to 8 s for `startup:ready` to appear in the temp log file (deterministic readiness check, no race).
  - Reports startup time in ms parsed from the event's `details.startup_ms`.

## Files Created

- `src/reddit_research/mcp/logger.py` — structured logger module
- `changelogs/2026-04-26_01_mcp-venv-binary-and-structured-logger.md` — this entry

## Files Modified

- `src/reddit_research/mcp/install.py` — `_resolve_command` prefers `.venv/bin/reddit-cli`
- `src/reddit_research/mcp/server.py` — startup events, lock-acquisition logging, `_wrap_tool_for_logging` shim, `mcp.run()` exception capture
- `src/reddit_research/cli/main.py` — `mcp logs` and `mcp stats` commands, `_parse_since` helper
- `scripts/mcp_doctor.sh` — deterministic readiness-based smoke launch

## Verification

- `mcp doctor` now reports all five layers green and **`startup:ready` in 372 ms**.
- Logger smoke (in-memory): 7 seeded events, severity-ordering filter, kind-prefix, tool filter, aggregate stats — all pass.
- Real server boot smoke: writes `startup:begin → startup:lock_acquired → startup:ready → startup:exit (uptime captured on SIGTERM)` to both file and SQLite.
- All three client configs now show `command: /Users/.../reddit-myind/.venv/bin/reddit-cli`, `args: ["mcp", "serve"]`, `MCP_TAKEOVER_STALE_LOCK=1`.

## How to use the logger going forward

```bash
# When MCP fails — diagnose in 30 seconds:
bash scripts/mcp_doctor.sh                       # 5-layer health check
reddit-cli mcp logs --severity error --since 1h  # exact errors with timestamps
reddit-cli mcp stats --since 24h                 # systemic patterns

# Spot recurring failure modes weekly:
reddit-cli mcp stats --since 7d
#   → top_tool_errors shows which tool is failing most
#   → slow_tools shows which exceed client timeouts (candidates for caching)
#   → by_kind: startup:lock_failed >0 means a client lacks takeover env

# Drill into a specific tool's traceback history:
reddit-cli mcp logs --tool openreply_synthesize_insights --severity error --json | jq '.[].details.traceback'
```

## Out of scope (follow-ups)

- A Settings panel widget that calls `mcp_stats` Tauri command and renders the same aggregates — currently CLI-only.
- Auto-rotation of the SQLite event store (right now grows unboundedly; in practice ~1 KB/event so 100k events ≈ 100 MB which is fine for years).
- Sentry / OTLP exporter for production — local-only by design today.
