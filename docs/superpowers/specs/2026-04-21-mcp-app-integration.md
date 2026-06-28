# MCP ↔ App integration — same DB, one-click connect

**Date:** 2026-04-21
**Status:** Spec for v1 implementation. Token gating deferred to a future iteration.

## Problem

The Tauri app and the `reddit-myind` MCP server both use `reddit_research.core.db` but resolve `data_dir` from `REDDIT_MYIND_DATA_DIR`. The app sets it to `~/Library/Application Support/com.shantanu.openreply/reddit-myind/`. The MCP, launched by Claude Code via `~/.claude.json`, has no `env` block — so it falls back to `<repo>/data/`, a completely different `reddit.db`.

Result: anything fetched/scraped/ingested through MCP tools (`openreply_research_collect`, `reddit_fetch_*`, `reddit_graph_*`) lands in a file the desktop app never reads. Two parallel realities.

## Goals

1. **Same DB.** MCP writes go to the same SQLite + Palace ChromaDB the app reads.
2. **One-click provision.** User shouldn't have to hand-edit `~/.claude.json` or know what `REDDIT_MYIND_DATA_DIR` is.
3. **Bundled with the app.** Once OpenReply is installed, connecting it to Claude Code is a Settings toggle, not a separate setup procedure.
4. **Future-proof for token gating.** Write the token now, even if we don't enforce it server-side until v2.

## Non-goals (v1)

- **Cryptographic auth.** Token written in v1 is a provisioning marker, not a real secret. Anyone on the same Mac can read `~/.claude.json` and get it. Server-side enforcement comes later.
- **Cross-machine MCP.** Local-first only. No remote MCP, no shared tokens across devices.
- **Auto-uninstall on app deletion.** macOS DMG drag-to-Trash leaves orphan MCP entries; we expose a "Disconnect" button instead of trying to hook into deletion.

## Design

### One-time provisioning flow

User opens **Settings → Integrations → Claude Code MCP**. Sees current state:

- `not connected` → button "Connect to Claude Code"
- `connected (DB aligned)` → button "Disconnect" + "Re-sync paths"
- `connected (DB mismatch)` → warning + "Re-sync paths" button (auto-fix)

### What "Connect" does

```
1. Resolve sidecar path:
     dev:  uv --directory <repo>  run reddit-cli mcp serve
     prod: <bundled binary>/reddit-cli mcp serve
2. Resolve data dir from app_data_dir() (same call cli.rs::data_dir uses).
3. Generate token: 32 random bytes → base64 → write to <data_dir>/mcp_token (mode 0600).
4. Read ~/.claude.json (create if absent), merge mcpServers["reddit-myind"]:
     {
       "command": "<resolved>",
       "args":    [...],
       "env": {
         "REDDIT_MYIND_DATA_DIR": "<data_dir>",
         "REDDIT_MYIND_TOKEN":    "<token>"
       }
     }
5. Atomic write: tmp file + rename. Backup previous as ~/.claude.json.openreply-bak once.
6. Show toast: "Connected. Restart Claude Code to pick up changes."
```

### What "Disconnect" does

- Remove `mcpServers["reddit-myind"]` from `~/.claude.json`
- Delete `<data_dir>/mcp_token`
- Don't restore the backup (user may have edited other entries since)

### What "Re-sync paths" does

- Same as Connect, but only updates `command` / `args` / `env` if the existing entry's `data_dir` doesn't match `app_data_dir()`. No new token.

### MCP server changes (v1)

**None enforced.** The server reads `REDDIT_MYIND_TOKEN` from env if present and remembers it for future v2 enforcement, but doesn't compare or refuse. v1 just provisions the wiring.

### MCP server changes (v2 — deferred)

```python
# In src/reddit_research/mcp/server.py startup:
expected = (Path(data_dir) / "mcp_token").read_text().strip()
got      = os.environ.get("REDDIT_MYIND_TOKEN", "")
if expected and got != expected:
    raise SystemExit("MCP refused: token mismatch. Re-connect from app settings.")
```

Behind a setting toggle so users who don't want enforcement can leave it off.

## Implementation surface (v1)

### New CLI subcommand

```
reddit-cli mcp install   [--data-dir PATH] [--bin PATH]
reddit-cli mcp uninstall
reddit-cli mcp status    [--json]
```

These do all the heavy lifting in Python (JSON merge, atomic write, token gen). The Tauri app shells out to them — keeps the OS-detection / path-finding / token-generation logic in one place, testable from CLI without launching the app.

### New Tauri commands

- `mcp_status() -> { installed: bool, connected: bool, db_aligned: bool, claude_path: string }`
- `mcp_install() -> { ok: bool, reason?: string }`
- `mcp_uninstall() -> { ok: bool }`

Each shells the CLI subcommand above. Same `run_cli` plumbing as everything else.

### New Settings UI

A new "Integrations" card in `screens/settings.js`:

```
Claude Code MCP
─────────────────────────────────
Status: Connected · DB aligned
Path:   ~/Library/Application Support/...
Token:  ●●●●●●●● (saved)

[ Re-sync paths ]   [ Disconnect ]
```

If Claude Code isn't installed (`~/.claude.json` doesn't exist):
```
Claude Code not detected.
Install it from claude.com/claude-code, then come back.
```

### Cross-platform paths

| OS      | Claude config path                       | Data dir base                                          |
|---------|------------------------------------------|--------------------------------------------------------|
| macOS   | `~/.claude.json`                         | `~/Library/Application Support/com.shantanu.openreply`    |
| Linux   | `~/.claude.json`                         | `~/.local/share/com.shantanu.openreply`                   |
| Windows | `%USERPROFILE%\.claude.json`             | `%APPDATA%\com.shantanu.openreply`                        |

All three use the same env-var contract — only path resolution differs. Use `app.path().app_data_dir()` and `dirs::home_dir()` (already in deps).

## Files to add / modify

**New:**
- `src/reddit_research/mcp/install.py` — install/uninstall/status logic, atomic JSON merge, token gen
- `src/reddit_research/cli/main.py` — new `mcp_app` Typer subgroup wiring the above
- `app-tauri/src-tauri/src/commands.rs` — three thin wrappers (`mcp_install`, `mcp_uninstall`, `mcp_status`)
- `app-tauri/src/screens/settings.js` — Integrations card

**Modified (purely additive):**
- `app-tauri/src-tauri/src/main.rs` — register the three new commands
- `app-tauri/src/api.js` — `api.mcpStatus / mcpInstall / mcpUninstall`
- `src/reddit_research/mcp/server.py` — read `REDDIT_MYIND_TOKEN` into a module-level var (no enforcement yet, just plumbed for v2)

## Risks

- **Editing user's `~/.claude.json` is sensitive.** Always atomic write, always back up the first time, never delete keys we didn't add.
- **Stale tokens.** If the user uninstalls the app without clicking Disconnect, the MCP entry references a deleted binary. Claude Code will fail to spawn it on next session — annoying but not destructive. Document a "Clean up" CLI: `reddit-cli mcp uninstall --force` runnable even after the app is gone.
- **Multiple OpenReply installs.** Two Macs syncing `~/.claude.json` via Dropbox would overwrite each other's `command` paths. Mitigate by including the user's home dir in a marker comment, but ultimately out of scope — local-first means local-first.

## Test plan

1. **Fresh Mac, Claude Code not installed** → settings shows "not detected", no errors.
2. **Claude Code installed, never connected** → click Connect → entry appears in `~/.claude.json` with right env → restart Claude Code → MCP tools return data from app's DB.
3. **Already connected, app moved (different bundled-binary path)** → "Re-sync paths" rewrites `command` without touching token.
4. **Disconnect** → entry removed, token file deleted, other `mcpServers` entries untouched.
5. **Manual edit to `~/.claude.json`** between Connect and Re-sync → re-sync preserves user's edits to other entries.
6. **Token file deleted manually** → status reports "token missing, re-connect" — not a hard error in v1.

## Future: better gating

When v1 is in users' hands and we have signal, revisit:

- **OS keychain** instead of plaintext token file (`security` framework on macOS, libsecret on Linux, DPAPI on Windows). Real secret protection for the token.
- **Capability-scoped tokens.** Read-only token for query/search MCP tools; write-token only for `collect`/`ingest`. Lets users grant Claude read-only access to their corpus without letting it scribble.
- **Time-boxed tokens.** Rotate every N days, app re-issues silently. Stale clones stop working without manual revoke.
- **Telemetry on misuse.** Log to app-side audit table when MCP requests come in; user can see "Claude accessed this DB at HH:MM via openreply_research_collect" in an Activity → MCP tab.

None of these are needed for v1. Ship the same-DB, one-click flow. Make it real first, secure it second.
