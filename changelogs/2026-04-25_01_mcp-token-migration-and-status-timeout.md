# MCP "keep loading" — token migration from license_state + UI safety timeout

**Date:** 2026-04-25
**Type:** Fix

## Summary

After 2026-04-24's keychain → file migration for the activation token,
the Tauri MCP Settings card sat in "checking…" forever for users who
had activated *before* that change. Root cause: `read_access_token`
now reads `<data_dir>/license_token`, but pre-existing users only had
the token in:

  1. The old macOS Keychain entry (now ignored — that's the whole point
     of the migration), and
  2. `license_state.json` under the `access_token` field (still
     written, but never read by `read_access_token`).

So `read_access_token` returned `None` → `ensure_mcp_allowed` errored
with `[mcp:token_missing]` → the Settings UI was supposed to render an
activation gate, but in practice the call could also stall on the
Python sidecar cold-start path before the token check, leaving the
"checking…" spinner forever.

## Changes

### `app-tauri/src-tauri/src/commands.rs`

`read_access_token` now has a fallback / one-time migration path. When
the file at `<data_dir>/license_token` doesn't exist or is empty, we
call `load_license_state(app)` and use the `access_token` field from
`license_state.json` if present. The recovered value is then written
to the canonical file location with `0600` perms so subsequent reads
hit the file directly. License-state JSON keeps the field — it's the
source of truth on disk; the file is the cache for hot reads.

This means previously-activated users self-heal on the next launch
without any manual re-activation: their token gets promoted from the
JSON to the file path and `ensure_mcp_allowed` succeeds.

### `app-tauri/src/screens/settings.js`

Added a 12 s safety timeout to `refresh()` in the MCP status card.
`api.mcpStatus(client)` is now `Promise.race`-d against a timeout
that throws `mcp_status timed out after 12000ms — sidecar may be
stuck`. If the Python sidecar wedges (DB lock, gatekeeper verification
stall, frozen import), the user sees an actionable error in the card
instead of an indefinite spinner. They can click Refresh / Re-sync to
retry, or Reset to recover.

12 s was picked by observation: a fresh dev-venv Python `mcp status`
on this machine returns in ~600ms; PyInstaller cold-start can take
5-8s on a newly-signed binary. 12s catches the genuinely-stuck case
without false-positive on cold starts.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — `read_access_token` fallback
  + write-through migration.
- `app-tauri/src/screens/settings.js` — `refresh()` timeout race.

## Verification

- `cargo check` in `app-tauri/src-tauri` — clean (only the known
  `JWT_DESKTOP_SECRET missing` warning, unrelated to this change).
- `node --input-type=module -e "import('./src/screens/settings.js')"`
  — OK.
- Direct CLI run: `./.venv/bin/python -m reddit_research.cli.main mcp
  status --json` returns `{installed: true, connected: true,
  db_aligned: true, has_token: true, token_in_env: true,
  takeover_configured: true}` — confirming the only real blocker was
  the desktop's token-read path, not the Python side.

## Notes

- The stale `mcp-server.pid` file in the data dir (PID 48294, dead
  process) is harmless: `_acquire_pidfile_lock` in
  `src/reddit_research/mcp/server.py` already reclaims a dead PID via
  `_is_alive()` before writing a new one. Manually deleting the file
  is fine but not necessary.
- If the user still sees "checking…" after this fix, the 12s timeout
  will surface the underlying error (sidecar timeout, missing
  client config path, etc.) instead of hiding it behind a spinner.
