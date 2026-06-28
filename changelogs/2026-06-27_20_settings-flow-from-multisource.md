# Settings flow — port the richer multi-source settings + fix the fake cadence

**Date:** 2026-06-27
**Type:** Feature + Fix

## Summary

The OpenReply Settings only exposed License / LLM / Appearance / RSS / Data, while the
backend (shared with the `multi-source` OpenReply app, whose `screens/settings.js` is a
2,739-line settings surface) supports much more. Surfaced the highest-value missing
capabilities and fixed a setting that was lying.

## Changes

- **Fixed the fake "Knowledge refresh" cadence.** It was `localStorage`-only and did
  nothing. Removed it from the Appearance card and replaced it with a real **Automation**
  card wired to the launchd scheduler: Off / Daily (24h) / Weekly (168h) →
  `schedule_install(hours)` / `schedule_uninstall`, showing live `schedule_status`.
- **New "Connect to apps (MCP)" card.** Register the app's MCP server with Claude Code /
  Claude Desktop / Cursor / Windsurf: client picker, live status (connected / DB-aligned),
  Connect / Re-sync / Disconnect, and Copy-config. Backed by
  `mcp_clients` / `mcp_status` / `mcp_install` / `mcp_uninstall` / `mcp_config_snippet`.
- **New "Usage & limits" card.** Today's LLM token spend (`today_token_spend`) + an
  editable daily token cap (`extraction_prefs_get` / `extraction_prefs_set` scope=global,
  `daily_token_cap`).
- **API wrappers** added for all of the above plus power-tools ready for follow-up:
  `installCli` / `uninstallCli` (`install_cli_symlink`), `exportPrefsGet` / `exportPrefsSet`,
  `costModelGet`.
- All new cards are searchable (Settings search `data-skw` keywords) and render
  defensively (loading / error / unavailable-platform states).

## Verification

- `vite build` passes (264 KB).
- Command paths confirmed live: `openreply mcp clients` (CLI), `extraction_prefs_get` /
  `today_token_spend` (direct Rust over `openreply.db`), `schedule_*` (pure Rust launchd).

## Files Modified

- `app-tauri/src/or/api.js` — schedule / mcp / extraction / cli / export wrappers.
- `app-tauri/src/or/dynamic.js` — Appearance simplified; new `buildAutomationCard`,
  `buildMcpCard`, `buildUsageCard`; registered in `renderSettings`.

## Deferred (still in multi-source `settings.js`, not yet ported)

Profile + avatar, App-mode (product/research), semantic-search (palace) + Whisper model
downloads, yt-dlp updater, aggressive-mode / dense-cards / confirm-delete prefs, trash
purge, prompt editor, Install-CLI + Export-folder cards (wrappers ready). These are
lower-priority for OpenReply or belong to Gap-Map-specific flows.

## Coordination note

`api.js` and `dynamic.js` were being edited concurrently (another session / linter) during
this work — changes were applied surgically and the build is green, but a visual diff
before committing is advised.
