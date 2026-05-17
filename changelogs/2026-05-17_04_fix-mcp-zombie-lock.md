# Fix: MCP server fails to connect — zombie process holds pidfile lock

**Date:** 2026-05-17
**Type:** Fix

## Summary

The MCP server intermittently failed to start in Claude Code (and any
client) with `another_mcp_server_running`, even though no server was
actually running and `MCP_TAKEOVER_STALE_LOCK=1` was set. Root cause: when
an MCP server crashes, the client (Claude Code / Cursor) does not always
reap the child immediately, leaving a **zombie/defunct** process. The
pidfile-lock liveness check, `_is_alive()`, used only `os.kill(pid, 0)` —
which **succeeds for a zombie** — so a new server concluded a live instance
held the lock. Stale-lock takeover then SIGTERM/SIGKILL'd the zombie, but
signals cannot touch a zombie, so takeover gave up and startup failed. The
lock was permanently un-reclaimable until the client process itself exited.

## Root cause investigation

- Reproduced by running the exact Claude Code MCP command + env →
  `{"error": "another_mcp_server_running", ...}` then `Connection closed`.
- `mcp-server.claude-code.pid` → PID 99498 → `ps` showed `<defunct>`, state
  `Z` (zombie).
- Traced `_acquire_pidfile_lock()` (`mcp/server.py:3178`): `_is_alive(99498)`
  returned `True` (kill-0 succeeds on zombies) → entered takeover → SIGTERM
  then SIGKILL had no effect on the zombie → `return False`.

## Changes

- `_is_alive()` (`mcp/server.py`) now excludes zombies: after `os.kill(pid,
  0)` succeeds it runs `ps -p <pid> -o state=` and treats a leading `Z` as
  dead. A zombie holds no resources and serves nothing, so a lock it appears
  to hold is reclaimable. Best-effort — a `ps` failure (e.g. Windows, where
  zombies don't exist) falls back to the kill-0 result, so no regression.
- With the fix, `_acquire_pidfile_lock()` sees the zombie as dead, skips the
  doomed takeover path entirely, and writes its own PID — the lock
  self-heals on the next server start.

## Verification

- New `tests/test_mcp_lock.py` — `test_is_alive_false_for_zombie` forks a
  child, exits it without reaping, asserts `_is_alive` reports it dead.
  Failed on the old code (`assert True is False`), passes on the fix.
- Full suite: 90 passed / 7 deselected.
- End-to-end: ran the exact Claude Code command + env with the zombie
  pidfile (PID 99498) still present → connected OK, 147 tools, live
  `reddit_diagnostics` call succeeded.

## Files Created

- `tests/test_mcp_lock.py`
- `changelogs/2026-05-17_04_fix-mcp-zombie-lock.md`

## Files Modified

- `src/reddit_research/mcp/server.py` — `_is_alive()` zombie detection
