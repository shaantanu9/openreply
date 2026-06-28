# Extraction worker: OOM is recoverable, no longer trips "gave up"

**Date:** 2026-05-31
**Type:** Fix (robustness)

## Summary

Fixes the "⚠ Extraction worker stopped after repeated crashes. Gave up after 3
restarts in 300s" banner. Two compounding causes:

1. **Ceiling too low.** `RSS_CEILING_MB = 600` — but chromadb + the ONNX MiniLM
   model alone are ~300 MB, and a large extraction batch routinely spiked past
   600 → the memory governor exited 137 every few batches.
2. **OOM counted as a crash.** `worker.rs::on_worker_exit` counted EVERY
   non-clean exit toward its 3-in-300s give-up window — including the governor's
   intentional `sys.exit(137)`, which is *recoverable* (restart = fresh memory
   after dropping chromadb+ONNX). So 3 OOM-recycles under heavy extraction
   wrongly tripped "gave up".

## Changes

- `src/openreply/research/enrich_worker.py` — `RSS_CEILING_MB` raised 600 → 1400
  (real headroom; still bounds a genuine leak), now env-overridable via
  `OPENREPLY_WORKER_RSS_MB`.
- `app-tauri/src-tauri/src/worker.rs` — `on_worker_exit` now treats exit code
  137 (OOM, intentional/recoverable) as a non-crash: restart with a 3 s backoff
  WITHOUT incrementing the give-up counter. Only genuine crashes (import error,
  segfault, other non-clean exits) accrue toward the 3-in-300s give-up.

Net: the worker recycles memory under load and keeps draining, instead of
giving up; real crash-loops still surface the banner.

## Files Modified
- `src/openreply/research/enrich_worker.py`
- `app-tauri/src-tauri/src/worker.rs`

## Verification
- `cargo check` — 0 errors.
- `py_compile` — clean.
