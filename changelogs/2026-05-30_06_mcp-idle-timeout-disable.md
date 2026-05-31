# MCP: disable idle self-exit watcher in client-managed entries

**Date:** 2026-05-30
**Type:** Fix

## Summary

The MCP server's idle-timeout watcher (`GAPMAP_IDLE_TIMEOUT`, default 1800s) calls `os._exit(0)` after 30 min idle. But when a stdio MCP server self-exits, the client (Claude Code / Cursor / Claude Desktop) marks it disconnected and does NOT auto-respawn — the user perceives "MCP keeps disconnecting" and must restart the client. Since the client already owns the subprocess lifecycle, the idle guard is redundant and harmful there. The install command now pins `GAPMAP_IDLE_TIMEOUT=0` in the MCP entry env, with a status check so pre-existing entries self-heal on the next auto-bootstrap.

Everything else in MCP setup-on-install was already correct: `timeout:60000` (cold-start headroom), `uv --directory run --all-extras` fallback, `MCP_TAKEOVER_STALE_LOCK=1`, per-client pidfile tag, ephemeral-path guard, and auto-bootstrap on boot + onboarding + activation.

## Changes

- `install.py`: add `GAPMAP_IDLE_TIMEOUT: "0"` to the written entry env.
- `install.py`: add `idle_disabled` to the status output + a re-sync reason so older entries self-heal.
- `mcp_bootstrap.js`: include `before?.idle_disabled !== false` in the "already ready" check so a stale entry triggers a re-sync.

## Files Modified

- `src/gapmap/mcp/install.py`
- `app-tauri/src/lib/mcp_bootstrap.js`

## Follow-up

Ships via the sidecar/CI DMG rebuild (Python-side change).
