# Fix: Claude Code MCP "Failed to connect" — repoint gapmap from hung bundled binary to dev-venv

**Date:** 2026-06-01
**Type:** Fix

## Summary

The Gap Map app's "Use with an MCP client" panel showed **"Connected to Claude Code · DB aligned"**, but Claude Code itself reported the `gapmap` MCP server as **"Failed to connect."** Root cause: the app's Connect feature wrote the Claude Code MCP config (`~/.claude.json`) to launch the **bundled PyInstaller binary** `/Applications/Gap Map.app/Contents/MacOS/gapmap-cli mcp serve`, which **hangs indefinitely on startup** — it never reaches `startup:ready` and never answers the MCP `initialize` handshake. Verified by probe: 75s with zero bytes of output and no `startup:begin` log line. Claude Code's 60s connect timeout therefore fails. The app's "Connected" indicator is misleading — it only verifies the config file + data paths are written/aligned, it does **not** drive the stdio handshake, so it never detects the hang.

The dev-venv entry point `/Users/shantanubombatkar/Documents/GitHub/reddit-myind/.venv/bin/gapmap mcp serve` responds to `initialize` in <1s (gapmap v3.2.4) and is the binary behind **every** successful connection in `logs/mcp-server.log`. Fix: repoint the user-scoped `gapmap` MCP server to the dev-venv binary (the battle-tested "dev-venv bypass" for PyInstaller-sidecar Gatekeeper/startup hangs).

## Changes

- Diagnosed via direct MCP `initialize` probe of both binaries:
  - Bundled `gapmap-cli`: 0 bytes after 75s → genuinely hung.
  - Dev-venv `gapmap`: valid JSON-RPC `initialize` result, `serverInfo.name=gapmap`, `version=3.2.4`.
- Confirmed token match: `mcp_token` file == config `GAPMAP_TOKEN` (not an auth issue).
- Backed up `~/.claude.json` to `~/.claude.json.bak-gapmap-1780290369`.
- Removed + re-added the user-scoped `gapmap` server via `claude mcp` CLI (Edit raced because Claude Code continuously rewrites `~/.claude.json`), changing only the `command` to the dev-venv path; preserved `args`, all `env` vars (GAPMAP_DATA_DIR, GAPMAP_TOKEN, MCP_TAKEOVER_STALE_LOCK, MCP_CLIENT_TAG, GAPMAP_IDLE_TIMEOUT).
- Verified: `claude mcp list` now reports `gapmap … ✓ Connected`.

## Files Modified

- `~/.claude.json` (user MCP config, outside repo) — `mcpServers.gapmap.command` changed from the bundled app binary to `/Users/shantanubombatkar/Documents/GitHub/reddit-myind/.venv/bin/gapmap`.

## Underlying product bugs to fix (not done here)

1. **Bundled `gapmap-cli mcp serve` hangs on startup** — never writes `startup:begin`/`startup:ready`. Aligns with the known no-timeout daemon handshake (`read_line()` / `run_cli` `output()` await with no timeout). Needs a startup timeout + fast-fail so the bundled binary is usable as an MCP server, or the app must prefer the dev-venv path in a dev checkout.
2. **App "Connected" status is a false positive** — it should perform a real `initialize` round-trip (with a timeout) before claiming the client is connected, instead of only checking config/path alignment.
