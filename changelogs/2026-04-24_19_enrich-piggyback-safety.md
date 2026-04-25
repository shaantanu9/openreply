# Streaming enrich: safety timeout + inline Unstick on piggy-back path

**Date:** 2026-04-24
**Type:** Fix

## Summary

`runEnrichStreamForTopic` subscribes to `enrich:progress` +
`enrich:stream:done` events and then calls `enrich_graph_stream`. If
the Rust side says `already_running: true` (the `ActiveGraphOps` dedup
lock is held by another enrich), the helper displayed
"Another enrichment for this topic is already running — piggy-backing
on it…" and waited for `enrich:stream:done` from that other run.

Problem: if the other enrich's Python sidecar died BEFORE emitting
`enrich:stream:done` — SIGKILL, panic, parent Tauri quit mid-stream,
etc. — the done event never fires. The lock's own 10 min staleness
reclaim doesn't help the current promise, which sits forever showing
"piggy-backing on it…" with no way to recover short of a full app
restart.

## Changes

`app-tauri/src/screens/topic.js` — inside `runEnrichStreamForTopic`:

- Moved `let piggyWatchdog = null` up to the promise-scope so
  `finalize()` can clear it when the real stream terminates.
- On `already_running: true`:
  - Status line now includes `age_seconds` from the Rust response
    (e.g. "started 42s ago") so users see how stale the "running"
    claim really is.
  - An inline **Unstick & retry** button is appended to the banner.
    Click → `api.clearGraphInflight(topic, 'enrich')`, unlisten the
    current stream, recursively call `runEnrichStreamForTopic` fresh,
    and resolve the outer promise with its result. The button
    auto-upgrades to primary style after the watchdog fires.
  - A 3 min `setTimeout` watchdog (`piggyWatchdog`) fires if no
    progress arrives in that window. Updates the status copy to
    "No progress in 3 min — the other enrichment may be stuck. Click
    Unstick & retry." Chosen over a generic timeout that auto-cancels:
    the user is the right judge of "is this really stuck" when the
    lock age vs observed progress is ambiguous.
- `finalize()` now calls `clearTimeout(piggyWatchdog)` so a healthy
  finish doesn't leave a dangling timer.

## Files Modified

- `app-tauri/src/screens/topic.js`

## Verification

- `node --input-type=module -e "import('./src/screens/topic.js')"` — OK.

## Interaction with earlier fixes

- This layers cleanly on the 2026-04-24_16 "Unstick" escape hatch:
  the non-streaming `runEnrichFromMap()` already uses a `confirm()`
  dialog + `api.clearGraphInflight`. The streaming path now has an
  in-banner equivalent so users don't have to know about two
  different code paths.
- The Rust-side `GRAPH_OP_STALE_AFTER = 600s` auto-reclaim still
  applies as a last-resort safety net.

## Why not auto-unstick after 3 min

A genuinely slow Ollama cold-start on an old laptop can take 90-120 s
before first progress event, then another ~60 s per extractor (4
extractors × 60 s sequential). 3 min with no progress IS unusual but
not impossible. Forcing the user to click trades "one extra click when
truly stuck" for "never accidentally killing a healthy slow run".
