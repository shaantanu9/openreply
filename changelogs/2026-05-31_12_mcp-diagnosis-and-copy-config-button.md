# MCP "not working" diagnosis + Settings "Copy config" button

**Date:** 2026-05-31
**Type:** Fix + Feature

## Summary

Investigated why the openreply MCP kept disconnecting, found the real cause, and
added a long-requested "Copy config" path so users can add OpenReply's MCP entry
to any client by hand.

### Diagnosis (root cause of the disconnects)
Systematic, boundary-by-boundary tracing:

- The **`openreply`** MCP entry in `~/.claude.json` is fully healthy and hardened
  (`timeout: 60000`, `MCP_TAKEOVER_STALE_LOCK=1`, `MCP_CLIENT_TAG=claude-code`,
  `OPENREPLY_IDLE_TIMEOUT=0`); `mcp status` → all flags true, `reason: null`.
- A **second, stale `reddit-myind` entry** pointed at `.venv/bin/reddit-cli`
  (the *old* `reddit_research` package from before the repo was renamed to
  openreply; not in current `pyproject.toml`). It had **no `timeout` field**, so it
  inherited the client's 12s default — but the server cold-starts in ~20s, so
  the client SIGTERM-killed and retried it repeatedly → the disconnect churn
  seen in `mcp logs` (`startup:begin` → killed at +10s → `begin` again).
- That stale entry is now **gone** (Claude Code pruned it earlier in the session,
  which is what triggered the in-session "openreply MCP disconnected" notice). Only
  the healthy `openreply` entry remains. A backup was taken at
  `~/.claude.json.bak-mcpfix` (can be deleted).
- Measured cold-start: `initialize` handshake ≈ **20s**, dominated by imports
  (`fastmcp` ~4.8s, `sqlite_utils`→`pandas` ~2.7s) + ~147-tool registration —
  NOT eager DB/palace work (palace is already lazily imported per tool). This is
  *tolerated* by the `openreply` entry's `timeout: 60000`, so it's slow-but-working.
  A true latency fix would be the HTTP-daemon transport (`serve --transport http`,
  already supported) to amortize startup across reconnects — deferred (needs
  app-managed daemon lifecycle).

### Feature: "Copy config" button
The Settings "Use with an MCP client" card could only auto-write configs (and is
licence-gated). There was no way to copy the JSON to add it by hand or to a
client the app doesn't auto-write. Added a **Copy config** button that builds the
*exact* entry Connect would write — byte-identical, including all hardening
fields — without touching any file or minting a token, copies it to the
clipboard, and shows it inline with the target config path.

## Changes

- `src/openreply/mcp/install.py` — new `config_snippet()` dry-run that returns the
  `{mcpServers: {openreply: <entry>}}` snippet + target path, reusing the same
  `_resolve_command` + env-block logic as `install()` (no write, no token mint).
- `src/openreply/cli/main.py` — new `openreply mcp config` command (`--client`,
  `--data-dir`, `--project-dir`, `--bin`, `--json`).
- `app-tauri/src-tauri/src/commands.rs` — new `mcp_config_snippet` Tauri command
  mirroring `mcp_install`'s dev/bundled path resolution + ephemeral-path guard.
- `app-tauri/src-tauri/src/main.rs` — registered `mcp_config_snippet`.
- `app-tauri/src/api.js` — `mcpConfigSnippet(client)` binding.
- `app-tauri/src/screens/settings.js` — "Copy config" button + inline snippet
  panel (path + JSON) wired to `api.mcpConfigSnippet`.

## Verification

- `openreply mcp config --client cursor --project-dir . --json` → returns the full
  hardened snippet; confirmed it writes nothing.
- `cargo check` → 0 errors. `node --check` clean. `npm test` → 50/50.
  `npm run build` → ✓ (settings.js bundled).
- Not yet click-tested in a live window; recommend: Settings → pick a client →
  Copy config → confirm clipboard + inline panel.

## Files Modified

- `src/openreply/mcp/install.py`, `src/openreply/cli/main.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/api.js`, `app-tauri/src/screens/settings.js`

## Follow-up

- Optional: HTTP-daemon MCP transport to cut per-reconnect cold-start latency.
- Rebuild the bundled sidecar before the next DMG (the new `mcp config` CLI
  subcommand needs to be in the packaged binary for prod use; dev venv has it).
