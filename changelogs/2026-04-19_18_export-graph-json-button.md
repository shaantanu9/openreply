# Export Graph as JSON Button

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added an "Export graph JSON" button to the Actions tab on the Topic screen. This is the companion to the existing HTML export and wires up the already-working `reddit-cli research graph export --format json` CLI command through to the desktop UI. The exported file is written to the app data directory as `gap-graph-<topic>.json`.

## Changes

- Added `export_graph_json` Tauri command in commands.rs (mirrors `export_html`, appends `--format json` to CLI args, outputs `gap-graph-<topic>.json`)
- Registered the new command in the `tauri::generate_handler!` macro in main.rs
- Added `exportGraphJson` JS bridge in api.js (not cached — it's a side-effect/file-write)
- Added "Export graph JSON" button in the Actions tab export artifacts card in topic.js
- Wired click handler using the same status-line pattern as the other export buttons

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — new `export_graph_json` command after `export_html`
- `app-tauri/src-tauri/src/main.rs` — registered `commands::export_graph_json` in handler list
- `app-tauri/src/api.js` — added `exportGraphJson` wrapper
- `app-tauri/src/screens/topic.js` — button + click handler in Actions tab
