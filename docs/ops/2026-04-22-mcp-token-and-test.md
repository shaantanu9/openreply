# MCP Token + Verification Notes (2026-04-22)

## What `REDDIT_MYIND_TOKEN` is

`REDDIT_MYIND_TOKEN` is currently a provisioning marker used by the MCP installer/status flow. It is generated and stored in the data directory, then injected into the MCP client config entry.

Current behavior: the server reads it at startup, but does not enforce token auth yet.

## Where it is implemented

- Token lifecycle and config injection:
  - `src/reddit_research/mcp/install.py`
  - `_read_token`, `_write_token`, `_delete_token`
  - `install()` writes `mcpServers.<name>.env.REDDIT_MYIND_TOKEN`
- Server startup read:
  - `src/reddit_research/mcp/server.py`
  - `run()` reads `os.environ.get("REDDIT_MYIND_TOKEN", "")`

## How it flows

1. `reddit-cli mcp install` resolves data dir and config path.
2. Token is loaded from `<data_dir>/mcp_token` or generated if missing.
3. Installer writes token into MCP entry env:
   - `REDDIT_MYIND_DATA_DIR`
   - `REDDIT_MYIND_TOKEN`
4. `reddit-cli mcp status` verifies:
   - install/connect state
   - DB alignment
   - token file exists
   - env token matches token file (`token_in_env`)
5. `reddit-cli mcp serve` starts FastMCP and reads token env value (no enforcement yet).

## MCP test run (today)

Executed from repo root (`/Users/shantanubombatkar/Documents/GitHub/reddit-myind`):

```bash
uv run reddit-cli mcp status --client cursor --json
uv run reddit-cli mcp status --client claude-code --json
printf '' | uv run reddit-cli mcp serve
```

### Result: cursor status

```json
{"installed": true, "connected": true, "db_aligned": true, "has_token": true, "token_in_env": true, "config_path": "/Users/shantanubombatkar/.cursor/mcp.json", "data_dir": "/Users/shantanubombatkar/Library/Application Support/com.shantanu.gapmap/reddit-myind", "entry_data_dir": "/Users/shantanubombatkar/Library/Application Support/com.shantanu.gapmap/reddit-myind", "claude_present": true, "client_present": true, "client": "cursor", "server_name": "reddit-myind", "reason": null}
```

### Result: claude-code status

```json
{"installed": true, "connected": true, "db_aligned": true, "has_token": true, "token_in_env": true, "config_path": "/Users/shantanubombatkar/.claude.json", "data_dir": "/Users/shantanubombatkar/Library/Application Support/com.shantanu.gapmap/reddit-myind", "entry_data_dir": "/Users/shantanubombatkar/Library/Application Support/com.shantanu.gapmap/reddit-myind", "claude_present": true, "client_present": true, "client": "claude-code", "server_name": "reddit-myind", "reason": null}
```

### Result: server startup probe

`reddit-cli mcp serve` started successfully and printed FastMCP startup banner:

- Server: `reddit-myind`
- FastMCP version: `3.2.4`
- Transport: `stdio`

This confirms the MCP server boots cleanly in current environment.

## Conclusion

MCP is working properly for configured clients (`cursor`, `claude-code`) with token/file/env alignment passing. `REDDIT_MYIND_TOKEN` is wired and validated by installer/status, and is ready for future auth enforcement.
