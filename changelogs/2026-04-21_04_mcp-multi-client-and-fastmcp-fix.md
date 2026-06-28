# MCP multi-client picker + fastmcp auto-install fix

**Date:** 2026-04-21
**Type:** Feature + Fix

## Summary

Two related changes on top of the v1 MCP integration shipped earlier today:

**1. Multi-client picker (feature).** The Settings → "Use with an MCP client" card now exposes a dropdown of every supported client — Claude Code, Claude Desktop, Cursor, Windsurf, Cline — with a ✓ next to the ones it detects on disk. Same Connect / Re-sync / Disconnect flow drops the `reddit-myind` MCP entry into whichever client the user picks. The selection is remembered in localStorage. Same install flow works for any MCP client because they all share the `mcpServers` JSON shape — only the config path differs. Anyone with the app can wire it into any client; without the app there's no token + no sidecar binary, so the integration is gated by app installation.

**2. fastmcp auto-install (fix).** Symptom: `/mcp` panel in Claude Code stuck on `reddit-myind · ○ connecting…` forever. Root cause: `fastmcp` (the `[mcp]` extra) wasn't installed in the project venv that `uv run reddit-cli mcp serve` uses, so `from fastmcp import FastMCP` raised, the server exited on import, and the client hung waiting for an MCP handshake that never came. Was failing silently on the old entry too — only spotted because the new Settings UI surfaces MCP state.

Fix: `_ensure_mcp_extra_in_project()` in `mcp/install.py` runs `uv pip install -q -e .[mcp]` before writing the entry whenever install was called with `--project-dir` (dev mode). Idempotent + fast (~1s when fastmcp already present, 120s timeout to handle first-run cold installs).

## Changes

- New `mcp clients` CLI subcommand returning `[{key, label, path, present}]` for all known MCP client config paths
- `mcp install / uninstall / status` accept `--client {claude-code|claude-desktop|cursor|windsurf|cline}`
- Tauri commands `mcp_status`, `mcp_install`, `mcp_uninstall` now take an optional `client` arg; new `mcp_clients` command
- JS bridges `api.mcpClients() / mcpStatus(client) / mcpInstall(client) / mcpUninstall(client)` updated
- Settings card replaced — added client `<select>` populated from `api.mcpClients()` with ✓ markers, refresh button, per-client install/disconnect/re-sync flow
- `mcp/install.py` runs `uv pip install -q -e .[mcp]` automatically in dev-mode installs; result returned in the install response as `extra_install: {ok, ran, reason?}`
- `status()` response now also returns `client` and `client_present` (legacy `claude_present` kept for backwards compat)
- New global skill `~/.claude/skills/fastmcp-app-integration/SKILL.md` extracted from this work for reuse in other apps

## Files Modified

- `src/reddit_research/mcp/install.py` — multi-client (`known_clients`, `resolve_client`, `list_clients`, `_resolve_config`), `_ensure_mcp_extra_in_project`
- `src/reddit_research/cli/main.py` — `mcp clients` subcommand + `--client` on install / uninstall / status
- `app-tauri/src-tauri/src/commands.rs` — `mcp_clients` command + optional `client` arg on the existing three
- `app-tauri/src-tauri/src/main.rs` — registered `mcp_clients` in `generate_handler!`
- `app-tauri/src/api.js` — multi-client signatures
- `app-tauri/src/screens/settings.js` — client picker, per-client wiring, ✓ markers
- `changelogs/2026-04-21_04_mcp-multi-client-and-fastmcp-fix.md` — this entry

## Files Created

- `~/.claude/skills/fastmcp-app-integration/SKILL.md` (global, not in repo) — reusable skill
