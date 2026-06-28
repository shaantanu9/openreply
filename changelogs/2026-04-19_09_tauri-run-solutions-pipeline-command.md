# Tauri Command: run_solutions_pipeline + JS Bridge

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added the `run_solutions_pipeline` Tauri command that bridges the JS frontend to the Python `reddit-cli research solutions --topic X --json` CLI subcommand. The command follows the same thin-bridge pattern as all other commands.rs entries and is registered in the Tauri handler list and exposed via api.js.

## Changes

- Added `run_solutions_pipeline` async Tauri command in commands.rs after `build_graph`
- Registered `commands::run_solutions_pipeline` in the `generate_handler!` list in main.rs
- Added `runSolutionsPipeline: (topic) => invoke('run_solutions_pipeline', { topic })` to api.js

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — new `run_solutions_pipeline` pub async fn
- `app-tauri/src-tauri/src/main.rs` — registered command in handler list
- `app-tauri/src/api.js` — added JS wrapper after `listOllamaModels`
