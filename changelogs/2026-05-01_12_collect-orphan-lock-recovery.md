# Collect: orphan-lock auto-recovery + Unstick affordance

**Date:** 2026-05-01
**Type:** Fix + UX

## Summary

The single-flight `start_collect` slot (`ActiveJob` / `ActiveJobPid`) could
end up "held" with no matching topic in `ActiveCollects`, putting the user
in a trap: the busy modal would show

> Currently collecting **"(orphan sidecar — name unavailable)"** · unknown
> elapsed.

…with two unhelpful options. "Queue" waited forever (the orphan never
emits `collect:done`), and "Stop and start" pretended to terminate a
process that was already dead.

This change reaps the orphan automatically before the user ever sees the
modal, adds a periodic sweeper for in-session orphans, and replaces the
modal's misleading Queue / Stop-and-start buttons with a clean **Unstick**
CTA in the orphan case.

## Why orphans happen

The slot is held but `ActiveCollects` is empty when:

- The sidecar dies between writes without its `Terminated` event reaching
  the streaming handler (panic, hard SIGKILL, OS OOM).
- `tauri dev` HMR-rebuilds the Rust binary while a sidecar is still
  attached — the old listener is dropped mid-flight.
- A bug elsewhere returns `Err` before the slot is cleared.

Since the slot is the gate `is_collect_running()` checks, every subsequent
`start_collect` is blocked indefinitely.

## Changes

### Backend (Rust)

- `commands.rs::start_collect` — before the busy-policy branch, detect
  the orphan condition (`map_empty && is_collect_running`) and call
  `cancel_active_job` (idempotent best-effort kill + slot drop). Emits
  `collect:orphan:reaped { trigger: "start_collect" }`.
- `commands.rs::clear_orphan_collect_lock` — new Tauri command. Returns
  `{ ok, was_orphan, slot_held, map_empty, killed }`. Refuses to clear the
  slot if `ActiveCollects` is non-empty (would clobber a real collect).
- `main.rs` — registered `clear_orphan_collect_lock` in
  `generate_handler!`. Added a periodic sweeper (8s tick) that performs
  the same orphan detection + reap so users sitting on a screen with a
  stale "Collecting now: …" status bar don't have to trigger a new
  collect to clear it.

### Frontend (vanilla JS)

- `components/CollectBusyModal.js` — accepts `isOrphan: boolean`. When
  true, renders a different layout: "Stale collect lock detected" eyebrow,
  one primary "Unstick & start" button, and Dismiss. Queue and
  Stop-and-start are deliberately hidden in the orphan case (both trap
  the user).
- `api.js` — new `clearOrphanCollectLock()` helper.
- `screens/collect.js` — `handleBlocked` now flags `isOrphan = true` when
  the JS-side snapshot also has no live topic. Handles the new
  `'unstick'` choice: calls `clearOrphanCollectLock()`, then retries
  `startCollect`. Falls back to the regular blocked-modal path if a real
  collect races into the slot between unstick and start.
- `screens/collects.js` — same orphan flag + unstick handler in the
  inline-form blocked path.
- `components/CollectStatusBar.js` + `screens/collects.js` — subscribe
  to `collect:orphan:reaped` so the "Collecting now" row clears
  immediately when the sweeper or `start_collect` reaps a stale lock,
  instead of after the next 1.5s poll.

### CSS

- `style.css` — added `.cbm-eyebrow--warn` (orange #B5581A) for the
  orphan modal's eyebrow. Reuses every other `.cbm-*` token.

## Why we kept the single-flight invariant

We deliberately did NOT lift the "one collect at a time" rule. The local
SQLite DB is single-writer; concurrent collects would clash on
`posts` / `topic_posts` / `graph_nodes` writes, and parallel sidecars
would also fight for the same Ollama / OpenAI rate limits. The right
parallelism story is per-topic write-serialization with a sidecar pool —
multi-day refactor, intentionally out of scope here.

## Files Created

- `changelogs/2026-05-01_12_collect-orphan-lock-recovery.md` (this file)

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — orphan reap in `start_collect`,
  new `clear_orphan_collect_lock` command.
- `app-tauri/src-tauri/src/main.rs` — register
  `clear_orphan_collect_lock` + periodic sweeper task in `setup`.
- `app-tauri/src/api.js` — `clearOrphanCollectLock` helper.
- `app-tauri/src/components/CollectBusyModal.js` — `isOrphan` mode.
- `app-tauri/src/components/CollectStatusBar.js` — listen for
  `collect:orphan:reaped`.
- `app-tauri/src/screens/collect.js` — orphan detection + 'unstick'
  choice.
- `app-tauri/src/screens/collects.js` — orphan detection + 'unstick'
  choice + listen for `collect:orphan:reaped`.
- `app-tauri/src/style.css` — `.cbm-eyebrow--warn`.

## Verified

- `cargo check` — clean (only the pre-existing `JWT_DESKTOP_SECRET`
  build-script warning).
- `node --check` on every modified JS file — all syntax-clean.
- IPC contract:
  - `clear_orphan_collect_lock` is a no-op when nothing is stuck
    (`was_orphan: false`) — safe to call from anywhere.
  - The reap path can never kill a real collect: it gates on
    `ActiveCollects::is_empty()` first.

## How it behaves now

```text
Case A — sidecar crashes mid-collect:
  · Sweeper notices slot held + map empty within ≤ 8 s.
  · cancel_active_job drops the slot, fires collect:orphan:reaped.
  · Status bar's "Collecting now: …" row vanishes.
  · User starts a new collect → runs immediately, no modal.

Case B — user starts collect before sweeper ticks:
  · start_collect detects orphan inline, reaps, proceeds normally.
  · No modal at all.

Case C — race: orphan + sweeper hasn't run + frontend gets blocked:
  · Modal opens with isOrphan = true.
  · User clicks "Unstick & start".
  · clearOrphanCollectLock returns was_orphan: true → start retries.
  · If a real collect raced into the slot meanwhile, fall through to
    the normal Queue / Stop-and-start modal.
```
