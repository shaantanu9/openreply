# Collect: queue + busy-modal + status bar

**Date:** 2026-04-30
**Type:** Feature + UX Fix

## Summary

Replaces the opaque `failed to start: another collect is already running.
Cancel it first.` error with three explicit user-facing policies and a
sticky status bar so the user always knows what's running and what's
queued.

The single-flight invariant (one Python sidecar at a time, one SQLite
writer) is **kept** — that's correct for write contention. What changed
is the UX around it: when you start a second collect we now offer
"queue", "cancel running and start", or "open running" instead of just
erroring.

## Root cause

The Tauri `start_collect` command short-circuited with an `anyhow!` error
the moment `ActiveJob`/`ActiveJobPid` was held. The error was:

- a string (no structured `blocked_by` metadata for the UI),
- offered no way to know which topic was blocking,
- offered no way to queue the new request,
- offered no way to swap focus.

## Backend changes (Tauri / Rust)

### New state — `CollectQueue` (`cli.rs`)

`Mutex<VecDeque<QueuedCollect>>` where `QueuedCollect = { topic, args,
queued_at }`. Registered in `main.rs`. Persists across `start_collect`
calls within the app session (cleared on quit).

### `start_collect` rewritten

- Now takes an optional `if_busy` parameter: `"error" | "queue" |
  "cancel_and_start"`.
- Same-topic dedup unchanged (still returns `{already_running: true}`).
- If a *different* topic is running and `if_busy="error"` (default):
  returns a structured `{ ok: false, blocked: true, blocked_by: { topic,
  started_at, elapsed_secs } }` instead of throwing.
- `if_busy="queue"`: appends to `CollectQueue`, returns `{ ok: true,
  queued: true, position, blocked_by, queued_at }`. Idempotent — already
  queued returns `already_queued: true`.
- `if_busy="cancel_and_start"`: SIGTERMs the running sidecar, waits
  150ms for the prior `collect:done` listener to remove the topic from
  `ActiveCollects`, then spawns the new collect inline. Returns
  `{ ok: true, started: true, cancelled: <prior-topic> }`.

### Auto-dequeue on completion

`run_collect_inner` (extracted from `start_collect`) now calls
`drain_collect_queue` after every collect terminates. The next queued
item is spawned via `tauri::async_runtime::spawn` so the listener that
triggered it never blocks. Emits `collect:queue:dequeued` so the UI can
update its state bar.

### Two new MCP / IPC commands

- `list_collect_queue() -> Vec<{topic, queued_at}>` — for the status bar.
- `cancel_queued_collect(topic: String) -> bool` — remove an item before
  it starts. Emits `collect:queue:cancelled`.

## Frontend changes

### `api.js`

- `startCollect(topic, aggressive, sources, skipReddit, ifBusy='error')`
  — new `ifBusy` argument.
- `listCollectQueue()`, `cancelQueuedCollect(topic)` — new helpers.

### `screens/collect.js`

- When `startCollect` returns `{ blocked: true, blocked_by }`, the
  screen now opens a modal (`showCollectBusyModal`) offering four
  choices — Queue / Cancel-and-start / Open-running / Dismiss — and
  branches on the choice.
- The modal is self-contained (no extra CSS file), styled with the
  brand tokens already in `style.css`, dismisses on backdrop click and
  Escape.

### New: `components/CollectStatusBar.js`

A sticky bar pinned just above the screen content via a new
`#collect-status-bar` slot in `index.html`. Visible only when something
is running OR the queue is non-empty. Shows:

- Running topic + elapsed timer + Cancel button + click-through to the
  running collect's log.
- "+ N queued: A, B, …" with an X chip per item to remove it.

Refreshes on every collect-related Tauri event (`collect:done`,
`collect:queue:enqueued`, `:dequeued`, `:cancelled`) and ticks every 2s
so the elapsed counter increments. Mounted once at app startup from
`main.js`. Hidden by default — it slides in only when there's
something to report.

### `style.css`

New `.collect-status-bar` block — uses the same brand tokens as the
rest of the app (accent `#1F4E79`, hairline `#E2E8F0`, ink `#0F172A`).
Includes a soft pulse animation on the running dot so the user can see
at a glance that the collect is alive.

## Verified

- `cargo check` — clean (warning about JWT_DESKTOP_SECRET dev fallback
  is unrelated and pre-existing).
- `node --check` on every changed JS file — all syntax-clean.
- IPC contract sanity-checked against the existing
  `active_collects` shape (`{ <topic>: <started_at_unix_secs> }` — raw
  number, not an object).

## Files Created

- `app-tauri/src/components/CollectStatusBar.js`
- `changelogs/2026-04-30_01_collect-queue-and-busy-modal.md`
  (this changelog)

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — new `QueuedCollect` struct +
  `CollectQueue` state.
- `app-tauri/src-tauri/src/commands.rs` — `start_collect` rewritten
  with `if_busy` policy, new `run_collect_inner` shared runner, new
  `drain_collect_queue` + `list_collect_queue` + `cancel_queued_collect`,
  added `Emitter` trait import for the `app.emit(...)` calls.
- `app-tauri/src-tauri/src/main.rs` — registered `CollectQueue::default()`
  + the two new commands in `generate_handler!`.
- `app-tauri/src/api.js` — `startCollect` ifBusy parameter,
  `listCollectQueue` and `cancelQueuedCollect` helpers.
- `app-tauri/src/screens/collect.js` — modal-driven flow when
  `start_collect` returns `blocked: true`.
- `app-tauri/src/main.js` — mounts the status bar at DOMContentLoaded.
- `app-tauri/index.html` — slot for the status bar above `<main>`.
- `app-tauri/src/style.css` — `.collect-status-bar` styles.

## Plus: parallel "topic recon" preview

The user added a follow-up: "there should be a parallel process that
in start of any topic should start to know the topic we are going to
fetch from number or sources" (and a clarifier — opensource / GitHub /
all sources properly from multiple sources).

### What it does

The moment a collect screen mounts, a new `CollectReconCard` runs three
calls **in parallel** with the actual collect:

1. `canonicalizeTopic(topic)` → canonical name + 5–10 LLM-scored search
   keyword expansions.
2. `discoverSubs(topic, 10)` → top relevant subreddits with subscriber
   counts and relevance score.
3. **New** `collectSourceCatalog(aggressive)` → static list of every
   external source the sidecar will sweep, mirrored from
   `research/collect.py`. Aggressive = 15 sources (HN, App Store, Play
   Store, Trustpilot, Product Hunt, RSS bundles, arXiv, OpenAlex,
   PubMed, GNews, Dev.to, Stack Overflow, GitHub, Trends).
   Quick = 8 sources.

### Live "fetched" state

As `collect:progress` lines arrive (`[hn] ✓ 23 posts`, `[r/Mortgages]
✓ 45 posts`, …), the matching chip flips from "queued" (gray hollow
dot) to "fetched: N" (accent-blue filled dot + count pill). The user
sees real numbers crystallise next to the predictions.

### Files added

- `app-tauri/src/components/CollectReconCard.js` — the recon UI.

### Files modified (additionally)

- `app-tauri/src-tauri/src/commands.rs` — new
  `collect_source_catalog(aggressive)` Tauri command.
- `app-tauri/src-tauri/src/main.rs` — registered the new command.
- `app-tauri/src/api.js` — `collectSourceCatalog(aggressive)` helper.
- `app-tauri/src/screens/collect.js` — new `<div id="recon-host">` slot
  above the Phase-A/B card; mounts the recon card on render; cleanup
  hooked into the screen's `cleanup()`.
- `app-tauri/src/style.css` — `.recon-card`, `.recon-chip*`, `.recon-kw*`
  styles using the same brand tokens as the status bar.

## How to use

```text
1. User searches a new topic while collect-A is running.
2. start_collect returns { blocked: true, blocked_by: { topic: 'A',
   elapsed_secs: 220 } }.
3. The modal appears with three buttons:
     • Queue this one (auto-starts when A finishes)  ← default highlight
     • Cancel A and start this one now
     • Open A's log →
4. The status bar at the top of the page shows
   "Collecting roofing marketplace · 3m 40s [Cancel]
    + 1 queued: ai coding assistants [×]"
   on every screen.
5. When A finishes, the queue drains: Tauri emits
   `collect:queue:dequeued`, the bar re-renders, and the queued
   collect's events start flowing.
```
