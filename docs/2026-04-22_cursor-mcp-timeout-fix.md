# Cursor MCP Timeout Fix (2026-04-22)

## Problem

Cursor MCP for `reddit-myind` was stuck in:

- `connecting`
- then `MCP error -32001: Request timed out`
- finally `connect_failure`

Observed log sample:

- `connection:connect_start: conn=connecting`
- `Failed to reload client: Aborted`
- `Connection failed: MCP error -32001: Request timed out`

## User-facing impact

- OpenReply MCP server did not connect in Cursor.
- MCP tools were unavailable even though install status looked partially correct in other clients.

## Root causes found

### 1) Cursor entry pointed to unstable debug sidecar binary

Cursor `~/.cursor/mcp.json` had `reddit-myind` mapped to:

- `app-tauri/src-tauri/target/debug/reddit-cli mcp serve`

That debug path is fragile in dev (stale artifacts, rebuild drift, binary mismatch), and led to connection instability/timeouts.

### 2) Multiple stale MCP server processes running concurrently

Several `mcp serve` processes were alive at once (from old sessions / different launch paths).  
Server has PID-file locking (`mcp-server.pid`), so overlapping processes can cause lock conflicts and bad connection behavior.

### 3) Tauri-side install path preference in dev

Tauri `mcp_install` command preferred `--bin` when a sidecar/debug binary existed, instead of preferring Python project mode in dev.

This kept writing binary-based entries into client configs, reintroducing the issue after reconnect/reinstall from app UI.

## What was fixed

## A) Reinstalled Cursor MCP entry to Python/FastMCP command

Rewired Cursor MCP entry to use:

- `command`: `.venv/bin/python`
- `args`: `-m reddit_research.cli.main mcp serve`

This is the stable dev path for FastMCP in this repository.

## B) Cleaned stale MCP server processes

Killed all lingering `mcp serve` processes so only one server instance can own the lock at a time.

## C) Patched Tauri MCP install behavior (dev-safe)

Updated `app-tauri/src-tauri/src/commands.rs` in `mcp_install`:

- **before:** prefer `--bin` if sidecar/debug binary found
- **after:** prefer `--project-dir` in dev, fallback to `--bin` only when project dir is unavailable

Result: app UI "Connect MCP" now writes the Python project command in dev, preventing regression to debug-binary path.

## Commands used during diagnosis/fix

### Inspect MCP client availability and status

```bash
python -m reddit_research.cli.main mcp clients --json
python -m reddit_research.cli.main mcp status --client cursor --json
python -m reddit_research.cli.main mcp status --client claude-code --json
python -m reddit_research.cli.main mcp status --client claude-desktop --json
```

### Reinstall Cursor entry

```bash
python -m reddit_research.cli.main mcp install --client cursor --json
```

### Find and clean stale processes

```bash
ps -ax | rg "mcp serve|reddit-cli.*mcp"
pkill -f "reddit_research.cli.main mcp serve"
pkill -f "/.venv/bin/reddit-cli mcp serve"
pkill -f "target/debug/reddit-cli mcp serve"
```

### Verify Cursor config now points to Python

```bash
cat ~/.cursor/mcp.json
```

Expected `reddit-myind` entry:

- `command: /.../reddit-myind/.venv/bin/python`
- `args: ["-m", "reddit_research.cli.main", "mcp", "serve"]`
- env contains aligned `REDDIT_MYIND_DATA_DIR` and `REDDIT_MYIND_TOKEN`

## Verification checklist

Use this checklist after install/reconnect:

1. `mcp status --client cursor --json` returns:
   - `installed: true`
   - `connected: true`
   - `db_aligned: true`
   - `token_in_env: true`
2. No duplicate `mcp serve` processes in `ps`.
3. Cursor is fully restarted (not just tab reload).
4. Cursor MCP panel shows `reddit-myind` connected.
5. Run one MCP tool call and confirm data lands in:
   - `~/Library/Application Support/com.shantanu.openreply/reddit-myind`

## Operational notes

- MCP server startup can fail silently from client UI when stdio handshake mismatches or old processes hold lock. Always check process list + status CLI.
- In dev, Python command path is safer than debug binary path.
- If issue returns, first do:
  1) process cleanup, 2) `mcp install --client cursor`, 3) full Cursor restart.

## Files changed in this fix

- `app-tauri/src-tauri/src/commands.rs`
  - `mcp_install` command path selection updated (prefer project-dir in dev)
- `~/.cursor/mcp.json`
  - `reddit-myind` entry rewritten to Python/FastMCP command

