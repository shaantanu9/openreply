# Persona "Learn from all corpus" + batched ingest (8 posts per LLM call)

**Date:** 2026-05-31
**Type:** Feature

## Summary

A persona's conclusions felt thin because it only ever *learned from* a small
slice of the corpus: the manual "Scan all corpus" button ingested at most **500**
un-seen posts (auto-ingest 200, CLI default 50), each post costing one LLM call.
With a 100k corpus, conclusions were built from a tiny fraction of available
signal. Added two things:

1. **"Learn from all" capability** — a new button that counts every un-ingested
   post for the persona (native rusqlite read, daemon-free), shows a
   type-to-confirm dialog with the exact count + estimated LLM-call cost, and on
   confirm ingests the **entire** un-seen corpus. Resumable + idempotent (the
   `NOT EXISTS` filter means re-runs only process posts not yet learned).
2. **Batched distillation** — ingest now distills **8 posts per LLM call**
   (env-tunable `PERSONA_INGEST_BATCH_SIZE`, default 8) instead of one, cutting
   full-corpus cost/time ~8×. The model returns a JSON array keyed by 1-based
   post number, so each distilled lesson still maps back to its own source post
   (per-post memory + evidence trail preserved). Batch failures isolate to the
   batch — its posts stay un-ingested and are retried on the next run.

No Rust change was needed: `persona_agent_ingest` already forwards `limit` as a
`u32`, so passing the un-ingested count gives "learn from all" through the
existing `LIMIT ?` path.

## Changes

- `persona/ingest.py`:
  - `BATCH_SIZE` (env `PERSONA_INGEST_BATCH_SIZE`, default 8), batched system
    prompt + `_format_batch_user` + `_parse_json_array` + `_chunked`.
  - `ingest_persona` loop rewritten to distill per batch and map array results
    back to posts by index; preserves all existing event shapes
    (`start`/`memory`/`skip`/`error`/`done`) so the UI listener is unchanged.
  - Candidate SELECTs cap body at `substr(p.selftext, 1, 2000)` to bound memory
    on full-corpus runs (the loop already trimmed to 1500 chars — no signal
    lost).
- `screens/personas.js`:
  - New "Learn from all" button beside "Scan 500" in the persona head.
  - Counts un-ingested posts via `api.runQuery` (native), confirms via
    `confirmDestructiveAction` (type the persona name; shows count + ~N LLM
    calls), then streams ingest with `limit = count`.
  - Refactored the scan handler into a shared `runIngest(btn, limit, label)`
    used by both buttons (one stream/guard, both buttons disable together).
- `tests/test_persona_ingest.py` (new): asserts 2 posts → 1 batched LLM call →
  2 mapped memories, and that a post omitted from the batch array is skipped.

## Files Created

- `tests/test_persona_ingest.py`

## Files Modified

- `src/openreply/persona/ingest.py`
- `app-tauri/src/screens/personas.js`

## Verification

- `pytest tests/test_persona_ingest.py tests/test_enrich_worker.py` → 6 passed.
- `node --check src/screens/personas.js` → OK · `npm run build` → ✓ built.

## ⚠ Production note

This is a Python sidecar change. Dev mode (`.venv`) picks it up immediately, but
the **bundled DMG needs a sidecar rebuild + re-codesign** before the batched
ingest / learn-from-all reaches a packaged build:
`pyinstaller <spec> && cp dist/<bin> app-tauri/src-tauri/binaries/<bin>-<arch>-<os> && codesign --force --deep --sign - <bin>` (see `tauri-python-sidecar-app` Phase 9).

## Cost note

"Learn from all" is intentionally gated behind a count + type-to-confirm dialog
because a 100k-post corpus is ~12.5k LLM calls even batched. The quick "Scan
500" remains the default low-cost top-up.
