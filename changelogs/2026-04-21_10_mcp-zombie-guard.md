# MCP zombie-process guards — fixes the "app hangs" root cause

**Date:** 2026-04-21
**Type:** Fix — critical stability

## The hang you saw

Triaged via `ps aux` + `sample 73672` + `lsof`:

- **18 concurrent `reddit-cli mcp serve` processes** accumulated over 2+
  days (Apr 19, 20, 21) from Cursor / Claude Code sessions that didn't
  shut down cleanly on window close.
- Each orphan holds file locks on `reddit.db` + `palace/chroma.sqlite3` +
  the HNSW index.
- ChromaDB's Rust backend runs an HNSW-compaction thread (tokio worker)
  per process — with 18 processes compacting the same on-disk index,
  one process sits at **38% CPU continuously** burning cycles.
- The Tauri sidecar queue backs up waiting for DB locks. UI appears to
  hang on any action that touches the sidecar.

Confirmed experientially: killing the Sunday Apr 19 zombies during
investigation accidentally disconnected the active MCP session and
Cursor immediately lost all 73 `reddit-myind` tools. That's exactly
what end users hit — silent MCP death with no diagnostic.

## Three guards landed

All in `src/reddit_research/mcp/server.py::run()`. Each is best-effort
with a tunable env var so power users can disable.

### Guard 1 — PID-file lock

Writes `<data_dir>/mcp-server.pid` at startup. If it finds an existing
file whose PID is alive (`kill -0`), exits with a structured error to
stderr:

```json
{"error":"another_mcp_server_running","hint":"Kill ... or remove ...mcp-server.pid"}
```

Clean shutdown: `atexit` hook removes the lock.
Stolen lock: if the stored PID is dead (crash, `kill -9`), the new
process steals it.

### Guard 2 — Idle-timeout self-terminator

A daemon thread checks every 60 s. If stdin has had zero reads for
`REDDIT_MYIND_IDLE_TIMEOUT` seconds (default 1800 = 30 min), calls
`os._exit(0)`. Catches the case where the MCP client crashed or the
window was closed without a clean EOF — the Python child won't know
the socket is dead and would hang forever.

Monkey-patches `sys.stdin.readline` to bump a `last_activity` timer.
Cheap, invisible to FastMCP.

Set `REDDIT_MYIND_NO_IDLE_GUARD=1` to disable (for development).
Set `REDDIT_MYIND_IDLE_TIMEOUT=0` to disable.

### Guard 3 — Stale-sibling sweep on startup

Scans all `reddit-cli mcp serve` processes owned by the current user
older than `REDDIT_MYIND_SWEEP_STALE_DAYS` (default 1). Terminates any
that aren't the current PID. Uses `psutil` — if not installed, skips
silently.

Logs `[mcp] swept N stale sibling MCP server(s)` to stderr so the user
sees it.

## How this prevents the production hang

End-user scenario:
1. User installs Gap Map, connects the MCP to Cursor / Claude Code.
2. A `reddit-cli mcp serve` child spawns.
3. User closes Cursor window → MCP client doesn't send EOF → child
   still running.
4. User reopens Cursor → new child spawns. **Guard 3** sweeps the old
   one. **Guard 1** ensures only one running at a time going forward.
5. If somehow the user ends up with a disconnected long-lived child,
   **Guard 2** kills it after 30 min of stdin silence.

Net result: at most one `mcp serve` process per user, per data dir,
at any given time.

## Env-var reference

| Var | Default | Controls |
|---|---|---|
| `REDDIT_MYIND_IDLE_TIMEOUT` | 1800 | Idle-timeout guard seconds. 0 disables |
| `REDDIT_MYIND_NO_IDLE_GUARD` | unset | Set to 1 to disable idle guard |
| `REDDIT_MYIND_SWEEP_STALE_DAYS` | 1 | Min age for stale-sibling sweep. 0 disables |

## Operational notes

- The three guards are additive — one catches what another misses.
- `psutil` is optional; if not installed, only Guards 1+2 fire.
- The Tauri desktop app owns sidecar lifecycle already (`main.rs`
  `cancel_active_*` on Exit). These guards protect the MCP surface
  specifically.
- Manual recovery: if all else fails, `pkill -f "reddit-cli mcp serve"`
  and restart the app.

## Files Created

- `changelogs/2026-04-21_10_mcp-zombie-guard.md`

## Files Modified

- `src/reddit_research/mcp/server.py` — PID-file lock + idle-timeout
  watcher thread + stale-sibling sweep in `run()`. 120 new lines;
  existing behavior unchanged when all guards are disabled.
