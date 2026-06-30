# Fix "Collect exited -1" — orphan sweeper killing healthy streaming jobs

**Date:** 2026-06-30
**Type:** Fix

## Summary

"Find opportunities" (and any long `run_cli_streaming` job) failed with
**"Collect exited -1. Check the log above for the specific error."** whenever it
ran longer than ~40 seconds — which a real `reply find` almost always does,
since it scores candidate posts with per-post LLM calls.

Root cause: the periodic **orphan-lock sweeper** in `main.rs` reaps a held job
slot (`ActiveJob`/`ActiveJobPid`) when it sees "slot held **and** `ActiveCollects`
map empty" for two ~20s ticks. `ActiveCollects` is a leftover from the Gap Map
research engine (topic-based collect) and, after the decoupling into OpenReply,
**nothing ever inserts into it** — so the map is permanently empty and the
orphan condition was always true. Every streaming job that held the slot for
~40s was silently SIGTERM'd (`cancel_active_job_silent`), exiting with no code
→ `-1` → the unclassified "Collect exited -1" message.

Fix: restore the missing registration. `run_cli_streaming` now records the
in-flight job in `ActiveCollects` (with a start timestamp) and clears it on exit
— in both the dev (`child.wait()`) and prod (`Terminated`) paths. The sweeper
now treats a slot as an orphan only when there is **no fresh registered job**
(no entry, or an entry older than a generous 30-minute staleness window), so a
healthy long-running job is never reaped, while a slot stuck by a process that
died without a `Terminated` event is still reclaimed.

## Changes

- `cli.rs`: add `STREAMING_JOB_KEY`, `mark_streaming_job_active()`,
  `clear_streaming_job()`. Call `mark_streaming_job_active()` in
  `run_cli_streaming` after the mutual-exclusion guard (covers dev + prod);
  call `clear_streaming_job()` in the dev exit task and the prod `Terminated`
  handler.
- `main.rs`: sweeper now computes `no_fresh_job` from the registered job's
  start timestamp + a 30-min staleness window instead of plain `is_empty()`, so
  it only reaps genuinely-stale/stuck slots.

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — job registration helpers + register/clear in the streaming paths.
- `app-tauri/src-tauri/src/main.rs` — staleness-based orphan detection in the sweeper.
