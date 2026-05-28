# Manual Enrich Click Now Preempts In-Flight Auto-Enrich

**Date:** 2026-05-28
**Type:** Fix

## Summary

When the user opened the Map tab for a topic with no findings yet, an
auto-enrich fired in the background. If they then clicked the toolbar
"Enrich" button (or "Run" in the banner) for the same topic, the Rust
per-topic dedup lock made the second call return `already_running:true`
and the FE silently joined the in-flight stream ("Another enrichment for
this topic is already running (started 18s ago) — piggy-backing on it…").
This made user-initiated clicks feel like nothing happened, especially
when the auto-pass was a slow sequential "all categories" run and the
user wanted a faster single-category extraction.

Manual clicks now **preempt**: the in-flight sidecar is SIGTERMed, the
per-topic lock is cleared, and a fresh enrich is spawned with the user's
chosen `only` / `parallel` flags. When the user picks a single category
(e.g. "painpoints only"), an `all-categories` follow-up auto-queues after
their pass completes so features/workarounds/complaints don't strand
empty until the next click. Background auto-enrich keeps the existing
piggy-back behavior so re-opening the same Map tab doesn't kill its own
first-call sidecar.

## Changes

- New Rust command `cancel_enrich_for_topic(topic)` — SIGTERMs the child
  in `ActiveEnrich` (and the dev-venv PID in `ActiveEnrichPid`) AND
  removes `enrich:<topic>` from `ActiveGraphOps`, so the FE can preempt
  and re-spawn in one round-trip without leaving a zombie sidecar
  double-writing painpoints to SQLite.
- New helper `cancel_active_enrich(app)` in `cli.rs` — mirrors
  `cancel_active_chat` / `cancel_active_stream` patterns. Returns
  `killed: bool`.
- New JS API `api.cancelEnrich(topic)` in `src/api.js`.
- `runEnrichStreamForTopic(topic, opts)` in `screens/topic.js` gained two
  new opts:
  - `manual: bool` (default `false`) — when `true`, hitting the
    `already_running:true` response triggers preempt-and-retry instead of
    the piggy-back banner. Recursive retry passes `manual:true` so any
    second-level collision also preempts.
  - `fillMissingAfter: bool` (default `false`) — when `true` AND `only`
    is a single category, after the stream finalizes successfully fires
    a follow-up `runEnrichStreamForTopic(topic, { only: null })` so the
    remaining 3 categories also get extracted. Cheap re-run of painpoints
    (~10-20s on Ollama) is the price for one sidecar spawn vs. three.
- Toolbar `#btn-map-enrich` migrated from the non-streaming
  `api.enrichGraph` + `confirm()` dialog to `runEnrichStreamForTopic(…,
  { manual:true })`. The user now sees live extractor progress + sample
  painpoint titles instead of a 2-6 minute silent spinner, and the
  confirm popup is gone (preempt is the new default).
- Banner Run picker (category dropdown + Run) now passes
  `manual:true, fillMissingAfter:true` — picking "painpoints only" runs
  painpoints first, then auto-fills the rest.
- Banner "Retry painpoints only" button (after a zero-findings result)
  now passes `manual:true, fillMissingAfter:true`.
- Unstick-button retry path in the piggy-back banner now propagates the
  current `manual` / `fillMissingAfter` flags so post-unstick behavior
  matches the original call.

## Files Created

- `changelogs/2026-05-28_02_enrich-manual-preempt.md`

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — added `cancel_active_enrich(app)`.
- `app-tauri/src-tauri/src/commands.rs` — added
  `cancel_enrich_for_topic(app, topic)` Tauri command + import of
  `cancel_active_enrich`.
- `app-tauri/src-tauri/src/main.rs` — registered
  `commands::cancel_enrich_for_topic` in `generate_handler!`.
- `app-tauri/src/api.js` — added `cancelEnrich(topic)` invoke wrapper.
- `app-tauri/src/screens/topic.js`:
  - `runEnrichStreamForTopic` gained `manual` + `fillMissingAfter` opts.
  - `already_running:true` branch now preempts when `manual:true`.
  - `finalize()` now auto-queues an all-categories follow-up when
    `fillMissingAfter:true` AND `only` was set.
  - `runEnrichFromMap` rewritten to delegate to the streaming path with
    `manual:true` (no more `confirm()` popup).
  - Banner Run picker, banner "Retry painpoints", and Unstick-button
    retry call sites updated.

## Verification

- `cd app-tauri/src-tauri && cargo check` — clean (0 errors).
- `cd app-tauri && npm test` — 29/29 passed.
- `cd app-tauri && npm run test:rust` — 26/26 passed.
- JS syntax check (`node --check`) on `api.js` + `topic.js` — clean.

## Manual Test Notes

To verify in the running app:
1. Open the Map tab for a fresh topic with no findings (auto-enrich
   fires).
2. Within ~5 s, click the toolbar **Enrich** button (or banner **Run**
   with "painpoints only").
3. Banner should switch to "Preempting current run (started Ns ago) —
   starting your request…" then live extractor progress, NOT the
   "piggy-backing on it…" message.
4. If you picked a single category, after it completes the banner
   should switch to "Filling remaining categories…" and run a
   follow-up pass for the other 3.
