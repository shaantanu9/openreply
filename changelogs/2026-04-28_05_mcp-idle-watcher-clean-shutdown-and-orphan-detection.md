# MCP: idle-watcher clean shutdown + tool-call activity tracking + orphan detection

**Date:** 2026-04-28
**Type:** Fix

## Summary

The reddit-myind MCP server kept "auto-disconnecting" across all clients
(Claude Code, Claude Desktop, Cursor) even after the per-client pidfile fix
on 2026-04-27. Server stats showed the smoking gun: **36 `startup:begin`
events in 24 h vs. only 3 `startup:exit` events** — the server was being
killed ungracefully ~33 times per day, leaving a stale pidfile each time.

Three compounding bugs in the idle-timeout machinery, all fixed in this
change:

1. **Activity tracking was dead code.** `_start_idle_timeout_guard`
   monkey-patched `sys.stdin.readline`, but FastMCP wraps `sys.stdin.buffer`
   in its own `TextIOWrapper` and reads from THAT object's iterator —
   the patched `readline` on the original `sys.stdin` is never called.
   Result: `state["last"]` only ever held the startup time, so after
   `REDDIT_MYIND_IDLE_TIMEOUT` seconds (default 1800 = 30 min) the
   watcher fired regardless of how active the session actually was.

2. **`os._exit(0)` skipped atexit.** When the watcher fired it called
   `os._exit(0)`, which intentionally bypasses `atexit` — so neither
   `_release_pidfile_lock` nor the `startup:exit` log event ran. The
   pidfile was left pointing at a dead PID; the next client spawn had
   to use the takeover path (SIGTERM-then-SIGKILL) to reclaim it. The
   missing `startup:exit` events were the diagnostic we were missing.

3. **No orphan detection.** When Claude Code / Cursor crashed, their
   MCP child got re-parented to launchd (PID 1) and ran forever. Doctor
   sweep on 2026-04-28 caught one such orphan that had been alive
   2 h 14 min holding `mcp-server.cursor.pid`. fastmcp doesn't notice
   its stdin pipe has nothing on the other end, so without an explicit
   check the orphan accumulates.

A fourth gap fixed for completeness: the takeover path SIGTERMs the
prior server, expecting the default handler to raise `SystemExit` →
trigger `atexit` → log `startup:exit`. In practice FastMCP's anyio loop
sometimes swallows the exception, leaking the same dead-pidfile state.
An explicit SIGTERM/SIGHUP/SIGINT handler now runs the same clean
cleanup sequence.

After the fix: clean-shutdown end-to-end verified — server with a 5 s
idle threshold exits in ~62 s with `startup:exit` recorded
(`shutdown_reason=idle_timeout`) and the pidfile released.

## Changes

- **`src/reddit_research/mcp/server.py`**:
  - Added module-level `_LAST_ACTIVITY_TS` shared by tool wrapper + watcher.
  - Added `_bump_activity()` and wired it into `_wrap_tool_for_logging`'s
    `_logged` shim at both entry and exit so any tool dispatch (including
    long-running ones) refreshes the activity timer.
  - Added `_clean_shutdown_then_exit(reason, **details)` — runs
    `_release_pidfile_lock` + `log_event("startup:exit")` BEFORE calling
    `os._exit(0)` so the atexit-bypass leaks no state. Documented the
    "must use `os._exit` from a daemon thread" reasoning inline.
  - Added `_install_signal_handlers()` — explicit SIGTERM/SIGHUP/SIGINT
    handler that calls `_clean_shutdown_then_exit(reason="signal:sigterm")`,
    bypassing FastMCP's anyio swallow path.
  - Rewrote `_start_idle_timeout_guard`:
    - Removed the dead `sys.stdin.readline` monkey-patch.
    - Reads `_LAST_ACTIVITY_TS[0]` (populated by tool calls) instead.
    - Added orphan check (`os.getppid() == 1`) per 60-s tick.
    - Replaced `os._exit(0)` with `_clean_shutdown_then_exit(reason=...)`.
  - Wired `_install_signal_handlers()` into `run()` right after the
    pidfile-lock acquisition + atexit registration.

## Files Modified

- `src/reddit_research/mcp/server.py` — idle-watcher rewrite, clean
  shutdown helper, signal handlers, activity tracking via tool calls

## Files Created

- `changelogs/2026-04-28_05_mcp-idle-watcher-clean-shutdown-and-orphan-detection.md`

## Verification

End-to-end test (5 s idle threshold, fresh data dir, MCP_CLIENT_TAG=idle-test):

```
spawned pid=85445; watcher polls every 60s, idle threshold=5s
server exited rc=0 after ~62.2s
✅ stderr says idle-timeout fired
   logged events: ['startup:begin', 'startup:lock_acquired', 'startup:ready', 'startup:exit']
   startup:exit details: {'shutdown_reason': 'idle_timeout', 'idle_seconds': 5}
✅ startup:exit recorded with reason=idle_timeout
✅ pidfile released (clean shutdown bypasses os._exit's atexit-skip)
```

Tool-wrapper unit test: `_LAST_ACTIVITY_TS[0]` was 0.0 before the call
and 1777390500.85 after a `openreply_query_db("")` invocation — confirming
the wrapper now bumps activity on every tool dispatch.

`bash scripts/mcp_doctor.sh` — smoke launch reaches `startup:ready` in
443 ms (no perf regression from the new code paths) with a clean
`startup:exit` event recorded on shutdown.

## What this means for already-running servers

The currently-running MCP servers (PIDs 63655 and 64514 in dev) are
running the OLD code. They will continue to misbehave (idle-fire via
`os._exit`, leak pidfile) until they're restarted. Two ways to pick up
the fix transparently:

1. **Wait for natural reconnect** — when the client (Claude Code /
   Cursor) restarts the MCP child, the new spawn reads the venv's
   updated `server.py` automatically. No `mcp install` rerun needed
   in dev mode.

2. **Force-kill the running servers**:
   `pkill -f "reddit-cli mcp serve"` then click "Reconnect" in the
   client.

For Tauri prod-bundled installs (PyInstaller binary), the next app
build will pick up the change.

## Out of scope (follow-ups)

- `scripts/mcp_doctor.sh` warns "duplicates can race on the pidfile lock"
  whenever it sees ≥2 `mcp serve` processes — but with per-client
  pidfiles, having 3 simultaneous servers (one per client) is correct.
  Doctor should group by `MCP_CLIENT_TAG` and only warn on intra-tag
  duplicates.

- `_sweep_stale_siblings` (1-day cutoff) still kills any old `mcp serve`
  regardless of tag; should respect the per-tag scoping.

- The 30-min default `REDDIT_MYIND_IDLE_TIMEOUT` is still right for
  preventing zombie accumulation, but consider exposing it in the
  Settings panel so users with very intermittent MCP usage can extend
  it (or disable with `REDDIT_MYIND_IDLE_TIMEOUT=0`).
