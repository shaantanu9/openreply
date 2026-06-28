# Settings — full port of the valuable multi-source surface

**Date:** 2026-06-27
**Type:** Feature

## Summary

Continued porting everything worthwhile from the `multi-source` OpenReply settings
(`screens/settings.js`, 2,739 lines) into the OpenReply Settings, plus closing the
onboarding profile loop. Settings now exposes 12 cards covering the full backend surface
that matters for OpenReply.

## Changes (new cards)

- **Profile** (`buildProfileCard`) — name + deterministic avatar (initials/colour), email
  from licence; stored locally. **Closes the long-standing gap where onboarding collected
  `or-user-name` but never used it.** The sidebar footer now shows the avatar + name as a
  link to Settings (replacing "prototype UI"), updated live on save.
- **Semantic memory** (`buildSemanticCard`) — palace embedding-engine status + embedded-
  memory count + Re-index, the engine behind the learning loop's knowledge graph
  (`palace_model_status` / `palace_stats` / `palace_reindex`).
- **Power tools** (`buildPowerCard`) — install the `openreply` terminal CLI
  (`install_cli_symlink` / `cli_symlink_status`) and reveal the export folder
  (`export_prefs_get`).
- **About & support** (`buildAboutCard`) — app version (`check_app_version` / `cli_info`),
  email feedback (mailto), GitHub issues, and open-data-folder (`reveal_in_finder`).

(These join the cards added in changelog 20: Automation/real-schedule, Connect-to-apps/MCP,
Usage & limits.)

## API wrappers added

`cliSymlinkStatus`, `cliInfo`, `checkAppVersion`, `palaceModelStatus`, `palaceStats`,
`palaceReindex` (plus the prior schedule/mcp/extraction/export/cli wrappers).

## Verification

- `vite build` passes (279 KB).
- All new commands are registered Rust commands (verified in the command-surface scan):
  `palace_*`, `cli_info`, `check_app_version`, `cli_symlink_status`, `install_cli_symlink`,
  `export_prefs_get`.

## Files Modified

- `app-tauri/src/or/api.js` — about/version + palace wrappers.
- `app-tauri/src/or/dynamic.js` — `buildProfileCard`, `buildSemanticCard`, `buildPowerCard`,
  `buildAboutCard` + avatar helpers; registered all in `renderSettings` grid.
- `app-tauri/src/or/shell.js` — sidebar footer profile (avatar + name → Settings).

## Deferred (Gap-Map-specific, low value for OpenReply)

App-mode (product vs research) toggle, topic-trash purge, the system-prompt editor,
Whisper/yt-dlp on-device model-download manager, and page-tour reset. These are tied to
OpenReply's research workspace rather than OpenReply's reply/content flow.

## Coordination note

`api.js` / `dynamic.js` / `shell.js` were under concurrent edits during this work; all
changes applied surgically and the build is green. A visual diff before committing is advised.
