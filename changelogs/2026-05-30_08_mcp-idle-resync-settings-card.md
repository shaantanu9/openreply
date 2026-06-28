# MCP: surface the idle-timeout + per-client re-sync prompts in Settings & auto-heal

**Date:** 2026-05-30
**Type:** Fix

## Summary

The `install.py` MCP status check emits six re-sync triggers, each with a
distinct `reason`: `db_aligned`, `token_in_env`, `takeover_configured`,
`timeout_configured`, `client_tag_configured`, and `idle_disabled`. But two of
them — `idle_disabled` (the 2026-05-30 changelog `06` fix) and
`client_tag_configured` (per-client pidfile scoping) — were never wired into
the consumers:

- **Settings MCP card** (`renderState()`) had explicit "needs re-sync"
  branches only for `takeover_configured` and `timeout_configured`. A stale
  entry that the backend was flagging for an idle-watcher or per-client-tag
  re-sync was painted green "Connected · DB aligned", hiding the
  recommendation — so users kept hitting "MCP keeps disconnecting" with no
  visible fix.
- **`mcp_bootstrap.js`** auto-heal "already ready" check gated on
  `takeover_configured`, `timeout_configured`, and `idle_disabled` but **not**
  `client_tag_configured`, so a missing-tag entry was skipped as
  `already_ready` and never self-healed.

This closes both gaps so the Settings card surfaces every condition the
backend flags (full parity with the `reason` chain) and the auto-bootstrap
self-heals every one of them.

Verified the live `claude-code` entry end-to-end: re-synced it (wrote
`OPENREPLY_IDLE_TIMEOUT=0`), and `mcp status` now returns
`connected/db_aligned/token_in_env/takeover_configured/timeout_configured/
client_tag_configured/idle_disabled` all `true` with `reason: null`.

## Changes

- `settings.js`: add `client_tag_configured === false` and
  `idle_disabled === false` branches to the MCP card's `renderState()`, each
  rendering a warn dot, a specific status line, an explanatory detail, and the
  Re-sync / Disconnect buttons. Ordered to match the backend `reason` priority
  (… → timeout → client_tag → idle → green "DB aligned").
- `mcp_bootstrap.js`: add `before?.client_tag_configured !== false` to the
  "already ready" idempotency check so missing-tag entries self-heal on boot.

## Files Modified

- `app-tauri/src/screens/settings.js` — two new re-sync branches in the MCP
  `renderState()` chain.
- `app-tauri/src/lib/mcp_bootstrap.js` — `client_tag_configured` added to the
  auto-heal gate.

## Verification

- `node --check` on both files → OK.
- Flag-coverage audit: every backend `not out["…"]` re-sync trigger now has a
  matching Settings branch (db_aligned + token_in_env handled earlier in the
  chain; the four `*_configured`/idle triggers each have an explicit branch).
- `openreply mcp status --client claude-code --json` → all flags `true`,
  `reason: null` after re-sync.
