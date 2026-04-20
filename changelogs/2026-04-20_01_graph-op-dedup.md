# Prevent graph-op pileup: Rust-side `ActiveGraphOps` dedup

**Date:** 2026-04-20
**Type:** Fix

## Summary

Observed in production: the topic page stopped working because **11 concurrent `research graph enrich` sidecars** had stacked up for the same topic. Every one was queued behind Ollama (which serializes inference), every one was fighting for the SQLite write-lock on `graph_nodes`, and the user's click on **Build gap map** was queued behind them — appearing to "hang forever".

Root cause: the app's `loadMap()` auto-triggers `api.enrichGraph(topic)` whenever findings are zero. The Rust `enrich_graph` / `build_graph` commands had no in-flight lock. Every tab re-render + every manual click spawned a fresh Python sidecar. Once one was slow (Ollama on CPU), the next one stacked; once two stacked, the UI felt frozen → user clicked again; by the 11th, nothing moves.

## Fix

**Rust-side single-flight**. New `ActiveGraphOps(Arc<Mutex<HashSet<String>>>)` managed state. Both `build_graph` and `enrich_graph` now route through a `run_graph_op_deduped` helper:

1. Build key `"<op>:<topic>"` (e.g. `"enrich:calari tracking app"`)
2. Try to insert into the HashSet. If present → return immediately with `{ok: false, already_running: true, topic, op, reason}` — no sidecar spawned.
3. Otherwise insert, run `run_cli(...)` awaited, then remove the key on exit (success or error).

Different ops on the same topic run concurrently (build ≠ enrich touches different rows, both are safe). Different topics always run concurrently.

**Frontend**. `runEnrichFromMap` checks for `already_running: true` and shows a friendly `Already running` toast — does NOT call `loadMap()` in that branch (which would reset the spinner and invite a re-click loop).

## Why not a per-button debounce

Per-button debounce covers only the button. It doesn't cover `loadMap`'s auto-enrich or multiple tabs open on the same topic. The mutex is the right surface area — every code path that can spawn a sidecar now goes through one gate.

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — new `ActiveGraphOps` struct
- `app-tauri/src-tauri/src/commands.rs` — new `run_graph_op_deduped` helper; `build_graph` + `enrich_graph` both route through it
- `app-tauri/src-tauri/src/main.rs` — `.manage(ActiveGraphOps::default())` + import
- `app-tauri/src/screens/topic.js` — `runEnrichFromMap` recognizes `already_running` and shows a toast instead of looping

## Verification

- `cargo check` → clean in 1m 50s
- `node --check topic.js` → clean
- Killed the 11 stuck sidecars manually to unblock the user's current session. Restart `npm run tauri dev` to pick up the new Rust guard — subsequent double-clicks will no longer stack.

## Skill evolution

Added a new gotcha to `tauri-python-sidecar-app` documenting the pattern: any sidecar-spawning Tauri command that can fire from multiple UI paths (auto + manual) needs a mutex single-flight unless the Python side is idempotent and fast. Local-LLM + multi-trigger UI = livelock waiting to happen.
