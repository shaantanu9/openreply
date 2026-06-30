# Live streaming progress for "Find opportunities"

**Date:** 2026-06-30
**Type:** Feature / UX Enhancement

## Summary

"Find opportunities" was a single blocking call (~75s cold, ~40s warm) behind a
static "may take a minute" pulse — no movement, no partial results, so it read as
frozen/broken. The backend already runs the scan in parallel (8 gather workers,
6 score workers) and already emitted progress, and a `run_cli_streaming` Rust
primitive already existed — but `reply_find` ignored both. This wires the scan
to that streaming primitive and adds a live scan UI: per-platform ticks
("✓ Reddit · 15 found"), a scoring progress bar ("Scoring 18/42"), and
opportunity preview cards that stream in as each post is scored. On completion
the authoritative list is reloaded from the DB. The actual work is unchanged;
the wait now visibly shows the agent finding the best conversations.

## Changes

- **Backend (Python):**
  - `_bounded()` gained an optional `on_result(value, count)` callback, invoked
    on the consuming thread as each thunk finishes — lets callers stream live
    progress instead of only seeing the final list.
  - `find_opportunities()` now emits structured progress events (dicts):
    `scan` (platform count + names), `platform` (per-source done + count),
    `scoring` (total to score), and `scored` (running count + a lightweight
    preview: platform · title · LLM score).
  - `reply find` CLI gained a `--stream` flag: emits one NDJSON event per line
    to stdout plus a final `result` event, instead of the single JSON blob. The
    non-stream path is unchanged (full backward compatibility).
- **Bridge (Rust):**
  - New `reply_find_stream` command calls `run_cli_streaming` with
    `reply_find:progress` / `reply_find:done` events; registered in `main.rs`.
- **Frontend (JS):**
  - `api.js`: `replyFindStream()` + a generic `onEvent(name, cb)` helper (imports
    `listen` from `@tauri-apps/api/event`); both no-op safely outside Tauri.
  - `dynamic.js`: the `op-find` handler now subscribes to the two events, renders
    a live `scanPanel` (per-platform ticks, scoring bar, streamed preview cards),
    surfaces backend errors with a "Try again" retry, reloads the real list on
    `done`, and falls back to the old blocking `replyFind` when streaming isn't
    available (plain browser / older shell).

## Files Modified

- `src/openreply/reply/opportunity.py` — `_bounded` on_result; structured progress in `find_opportunities`.
- `src/openreply/cli/reply_cmds.py` — `--stream` NDJSON mode for `reply find`.
- `app-tauri/src-tauri/src/commands.rs` — new `reply_find_stream` command.
- `app-tauri/src-tauri/src/main.rs` — registered `reply_find_stream`.
- `app-tauri/src/or/api.js` — `replyFindStream`, `onEvent`, `listen` import.
- `app-tauri/src/or/dynamic.js` — streaming `op-find` handler + `scanPanel` live UI.

## Notes

- The `done` event carries only `{code, error_class, hint}` (not the result), by
  design — the frontend reloads the canonical, persisted, fused-score list from
  SQLite via the existing `load()` path on completion.
- Actual scan time is unchanged; this is a perceived-performance + transparency
  win. A future pass could add score caching to cut warm re-run time.
