# MCP HTTP transport — fix Cursor 5-min disconnect cycling

**Date:** 2026-04-30
**Type:** Fix

## Summary

Cursor's stdio MCP client cycles servers every ~5 min (each PID lived
exactly that long in `mcp-server.log` before a successor sent SIGTERM),
which dropped the transport mid-call and made every subsequent
tool call fail with "Not connected" until the chat session was reset.
Switched Cursor's `reddit-myind` entry to streamable-HTTP transport so
the server runs as a long-lived daemon and Cursor connects/disconnects
freely without ever signalling it. Claude Code and Claude Desktop keep
stdio (their lifecycle handling is fine) but get `REDDIT_MYIND_PALACE_EAGER=1`
added so the first semantic call doesn't hit the cold ONNX compile.

## Changes

- Added `--transport`, `--host`, `--port` flags to `reddit-cli mcp serve`.
  Default remains `stdio`; pass `--transport http` to run as a daemon.
- `mcp/server.py::run()` now accepts transport args, forwards them to
  `mcp.run()`, and skips the idle-timeout watcher when not in stdio mode
  (HTTP daemons must not self-terminate on quiet periods).
- `scripts/mcp_http_daemon.sh` — `start | stop | restart | status | logs`
  helper that nohup-detaches the server, writes a pidfile to the data
  dir, and waits up to 8s for the listener to come up. Sets
  `REDDIT_MYIND_NO_IDLE_GUARD=1` and `MCP_CLIENT_TAG=http-daemon` so it
  coexists with stdio servers (separate per-tag pidfile lock).
- Cursor `~/.cursor/mcp.json` reddit-myind entry rewritten from
  `command/args` form to `url: http://127.0.0.1:8765/mcp` with the
  bearer token in the `Authorization` header.
- `~/.claude.json` and Claude Desktop config: added
  `REDDIT_MYIND_PALACE_EAGER=1` to the env block — pays a one-time
  ~2-5s warmup at startup so first semantic_search isn't a cold-start
  miss inside Cursor's stdio request window.

## Verification

```
$ bash scripts/mcp_http_daemon.sh start
started, pid=68851, http://127.0.0.1:8765/mcp

$ curl -X POST http://127.0.0.1:8765/mcp -H 'Authorization: Bearer …' \
       --data '{"jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"openreply_palace_status","arguments":{}}}'
HTTP 200 t=0.182951s    # 172 ms server-side
```

Daemon stayed up >7 min uninterrupted (stdio servers were SIGTERM'd
every 5 min in the prior log).

## Files Created

- `scripts/mcp_http_daemon.sh`
- `changelogs/2026-04-30_03_mcp-http-transport-for-cursor.md`

## Files Modified

- `src/reddit_research/cli/main.py` — added `--transport/--host/--port`
  to `mcp serve`.
- `src/reddit_research/mcp/server.py` — `run()` accepts transport args,
  idle-timeout guard skipped for HTTP.
- `~/.cursor/mcp.json` — reddit-myind switched to URL/HTTP form
  (backup at `~/.cursor/mcp.json.bak.before-http`).
- `~/.claude.json` and Claude Desktop config — `REDDIT_MYIND_PALACE_EAGER=1`
  added (backups at `…bak.before-eager`).

## Known follow-up (not fixed here)

`openreply_semantic_search` still takes seconds (historic warm: ~3s, cold: ~8s)
and the eager-warmup occasionally hits a Chroma compactor error
(`Error sending backfill request to compactor: Failed to apply logs to
the hnsw segment writer`). The HTTP-transport switch removes the
*disconnect* impact (Cursor will wait on the request indefinitely),
but the search itself is still slow — separate ChromaDB tuning task.

## Cursor reload required

After this change, Cursor must re-read its MCP config:
`Settings → MCP → reddit-myind → toggle off/on`, or restart Cursor.
