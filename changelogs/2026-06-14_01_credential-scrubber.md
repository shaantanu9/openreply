# 1C — Credential scrubber (+ overlap findings for the rest of 1C)

**Date:** 2026-06-14
**Type:** Fix (security) + Documentation
**Part of:** WhyBuddy port roadmap, Wave 1C.

## Summary

Added a two-layer credential scrubber so secret/API-key patterns never reach
the live sidecar log/event stream, retained error buffers, or exports. The
other three 1C items were found to already exist in OpenReply and were not
re-implemented.

## Changes (committed)
- **`src/openreply/core/scrub.py`** — `scrub_secrets(text)` redacts known key shapes
  (`sk-`/`sk-ant-`/`sk-or-`, `gsk_`, `xai-`, `AIza`, `nvapi-`, `gh[pos]_`),
  `Authorization: Bearer …`, and `name=value` for api_key/token/secret/password/
  auth_token/ct0. Conservative — leaves normal prose untouched. 4 tests.
- **`app-tauri/src-tauri/src/cli.rs`** — a Rust `scrub_secrets` applied at **10
  emit sites** across all 6 streaming paths (`run_dev_python_streaming`,
  `run_cli_streaming`, `run_cli_chat_streaming`, `run_cli_stream_streaming`,
  `run_cli_enrich_streaming`) before every `emit` and `recent_lines.push_back`.
  No new crate dep (manual conservative scan). 6 Rust tests; full `cargo test`
  32 pass, 0 regressions.

## Already existed (not re-implemented — honest overlap)
- **RRF / hybrid search** — `retrieval/palace.py` already runs vector + BM25-rerank
  hybrid over the unified corpus.
- **NDJSON typed sidecar events** — `cli/main.py` already emits flushed NDJSON
  lifecycle events for collect/stream/workflow.
- **Idempotent ingestion** — `posts` (and friends) use `pk="id"`; upserts are
  already idempotent on re-run.

## Files Created
- `src/openreply/core/scrub.py`, `tests/test_scrub.py`

## Files Modified
- `app-tauri/src-tauri/src/cli.rs`
