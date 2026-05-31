# Extraction worker: crash-safe serve loop (stop "repeated crashes" banner on tab switching)

**Date:** 2026-05-31
**Type:** Fix

## Summary

Users saw "⚠ Extraction worker stopped after repeated crashes. Gave up after 3
restarts in 300s." appear when switching tabs frequently. Root cause: the Python
extraction worker's `serve()` loop only made the **batch body** crash-safe
(the `try/except` inside `_drain_batch`), leaving the queue `SELECT` that feeds
it (and the idle-tick `extraction_queue.count`) **unguarded**. A transient
`database is locked` on those reads — far more likely after the Wave-2 native
rusqlite read-path started firing frequent reads against the same WAL on every
tab switch — propagated out of `serve()` and crashed the process. The Rust
supervisor (`worker.rs`) restarted it, the crash recurred under sustained
tab-switching, and three crashes inside the 300s window tripped the
`supervisor-gave-up` give-up that drives the banner.

Fix: wrap the whole `serve()` per-iteration body in `try/except` so any
transient fault surfaces as a **non-fatal** `enrich:error` and the worker backs
off (`ERROR_BACKOFF_SEC = 5`) and keeps draining — the "crash-safe" behaviour
the module docstring already promised. The intentional OOM `sys.exit(137)` is
preserved by re-raising `SystemExit`, and the idle count is guarded with a
`-1` fallback. This fixes the symptom for **all** tabs because the worker is
shared.

Secondary: the red banner is inserted as `#main-content`'s first child, which
the router wipes on every tab switch, orphaning `hostEl`. Added an
`isConnected` re-attach guard so a later worker event can't write into a
detached node and silently fail to show.

## Root cause (verified)

- `src/gapmap/research/enrich_worker.py:466` — `rows = list(db.query(sql, params))`
  ran **outside** `_drain_batch`'s `try` (which starts at the extraction body).
- `src/gapmap/research/enrich_worker.py` idle path — `db["extraction_queue"].count`
  ran outside any `try` in `serve()`.
- Either raising (transient WAL lock under read contention) → propagates out of
  `serve()` → non-clean process exit → `worker.rs::on_worker_exit` counts a
  restart → 3 in `RESTART_WINDOW` (300s) → `enrich:supervisor-gave-up` →
  `gapmap:enrich-dead` → banner.

Reproduced with a unit test that makes `_drain_batch` raise once: on the old
code `serve()` re-raised (worker crash); with the fix it emits `enrich:error`
and continues.

## Changes

- `serve()` loop body wrapped in `try/except`; `except SystemExit: raise`
  preserves the OOM restart; `except Exception` emits `enrich:error`
  (`fatal=False`) and backs off `ERROR_BACKOFF_SEC` seconds, then continues.
- Added `ERROR_BACKOFF_SEC = 5` tunable (+ exported in `__all__`).
- Idle-tick `extraction_queue.count` guarded with a `-1` fallback.
- Banner `render()` now re-creates the host when `!hostEl || !hostEl.isConnected`.
- New regression test `test_serve_survives_transient_read_error`.

## Files Modified

- `src/gapmap/research/enrich_worker.py` — crash-safe `serve()` loop, `ERROR_BACKOFF_SEC`, guarded idle count.
- `app-tauri/src/main.js` — `isConnected` re-attach guard in the enrich-error banner `render()`.
- `tests/test_enrich_worker.py` — added `test_serve_survives_transient_read_error`.

## Verification

- `pytest tests/test_enrich_worker.py` → 4 passed (new regression test + 3 existing).
- `node --check app-tauri/src/main.js` → OK.

## Known related / follow-up

- `src/gapmap/core/db.py::_wal_self_heal` still deletes `-wal`/`-shm` on a
  checkpoint failure under the assumption of single-process DB access. That
  assumption weakened once the Rust native read-path began holding read-only
  WAL connections; deleting side-files while a reader is attached is a latent
  corruption hazard. It only triggers on a rare checkpoint failure, so it is
  left unchanged here and flagged for a focused follow-up.
