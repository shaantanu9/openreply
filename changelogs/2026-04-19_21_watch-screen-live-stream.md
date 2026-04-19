# Watch Screen — Live Reddit Stream at #/watch

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added a full-stack Watch screen at `#/watch` that streams new Reddit posts and comments in real time. Supports both keyword-filter mode (regex patterns) and firehose mode (every post/comment). Stream is foreground-only — automatically cancelled when the user navigates away. History tab shows past stream hits from the `stream_hits` SQLite table.

## Changes

- Added `--json` flag to `cmd_stream` in Python CLI; now emits NDJSON lines per hit when `--json` is passed, enabling UI parsing
- Added firehose support to `start_stream` in `stream.py`: when `keywords=[]`, every post/comment is treated as a hit (matched=[])
- Added `ActiveStream` + `ActiveStreamPid` state structs to `cli.rs` (parallel to `ActiveJob`/`ActiveChat` — stream/collect/chat run independently)
- Added `run_cli_stream_streaming` function (twin of `run_cli_streaming` using the new state slots)
- Added `cancel_active_stream` function
- Registered `ActiveStream` and `ActiveStreamPid` in `main.rs` manage chain
- Added three Tauri commands: `start_stream`, `cancel_stream`, `stream_status`
- Added JS bridge methods in `api.js`: `startStream`, `cancelStream`, `streamStatus`, `onStreamHit`, `onStreamDone`
- Created `app-tauri/src/screens/watch.js` with full toolbar, live feed, history tab, foreground-only hashchange cleanup
- Added `#/watch` route in `main.js`
- Added Watch nav link (radio icon) in sidebar after Search
- Added Watch CSS in `style.css`

## Files Created

- `app-tauri/src/screens/watch.js`
- `changelogs/2026-04-19_21_watch-screen-live-stream.md`

## Files Modified

- `src/reddit_research/cli/main.py` — added `--json` flag to `cmd_stream`
- `src/reddit_research/fetch/stream.py` — added firehose branch (empty keywords)
- `app-tauri/src-tauri/src/cli.rs` — ActiveStream structs + cancel_active_stream + run_cli_stream_streaming
- `app-tauri/src-tauri/src/commands.rs` — start_stream / cancel_stream / stream_status commands
- `app-tauri/src-tauri/src/main.rs` — state registration + handler registration
- `app-tauri/src/api.js` — JS bridge methods + event listeners
- `app-tauri/src/main.js` — import + route
- `app-tauri/index.html` — Watch nav link
- `app-tauri/src/style.css` — Watch CSS block
