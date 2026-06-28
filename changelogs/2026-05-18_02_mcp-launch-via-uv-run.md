# MCP server now launches via `uv run`; idle-timeout disabled for Claude Code

**Date:** 2026-05-18
**Type:** Infrastructure

## Summary

The `reddit-myind` MCP server kept disconnecting in Claude Code. Two root causes:
(1) the user-scope MCP entry in `~/.claude.json` launched the raw `.venv/bin/reddit-cli`
binary, bypassing `uv` entirely — fragile if the venv is recreated/moved and never
self-heals; (2) `server.py`'s idle-timeout guard (`REDDIT_MYIND_IDLE_TIMEOUT`, default
1800s) makes the server `os._exit(0)` after 30 min with no tool calls — when it
self-exits, Claude Code marks it disconnected and does not auto-respawn. Separately,
the project `.venv` had diverged from `uv.lock` (113 optional-dependency packages —
`fastmcp`, `chromadb`, `pyinstaller`, etc. — that a plain `uv sync` would prune).

## Changes

- Ran `uv sync --all-extras` to reconcile `.venv` with `uv.lock` (prepared 1, installed
  5, uninstalled 3 — minor `authlib`/`cachetools` version drift; added `opendataloader-pdf`,
  `pytest-asyncio`, `ruff`). The venv now matches the all-extras lock set exactly.
- Re-registered the `reddit-myind` MCP server in Claude Code user config via
  `claude mcp remove` + `claude mcp add`:
  - Command changed from `/Users/.../.venv/bin/reddit-cli mcp serve` to
    `/opt/anaconda3/bin/uv run --project <repo> --all-extras reddit-cli mcp serve`.
  - `--all-extras` is required — without it `uv run`'s implicit sync targets the
    base dependency set and would prune `fastmcp` (in the `mcp` extra), breaking the
    server. With `--all-extras` the venv stays whole (extras + build deps preserved).
  - Added `REDDIT_MYIND_IDLE_TIMEOUT=0` to the entry's env so the server never
    self-terminates while a Claude Code session is open — Claude Code owns the
    subprocess lifecycle. Existing env (`REDDIT_MYIND_DATA_DIR`, `REDDIT_MYIND_TOKEN`,
    `MCP_TAKEOVER_STALE_LOCK=1`, `MCP_CLIENT_TAG=claude-code`) preserved.
- Verified: `claude mcp get reddit-myind` and `claude mcp list` both report
  `✓ Connected`; the exact registered command launches cleanly from an arbitrary cwd.

## Trade-off noted

Setting `REDDIT_MYIND_IDLE_TIMEOUT=0` also disables the orphan-parent detection in
`_start_idle_timeout_guard` (the guard thread is skipped entirely when
`idle_seconds <= 0`). Orphaned servers (Claude Code crash) are still cleaned up by the
1-day `_sweep_stale_siblings` pass and the `MCP_TAKEOVER_STALE_LOCK` reclaim on next
start. A follow-up code change could decouple orphan-detection from the idle branch so
both protections survive `IDLE_TIMEOUT=0`.

## Files Created

- `changelogs/2026-05-18_02_mcp-launch-via-uv-run.md`

## Files Modified

- `~/.claude.json` (user Claude Code config — `mcpServers.reddit-myind` entry)
- `.venv/` (reconciled with `uv.lock` via `uv sync --all-extras`)
