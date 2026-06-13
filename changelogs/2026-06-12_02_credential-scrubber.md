# Credential Scrubber — Defense-in-Depth Secret Redaction

**Date:** 2026-06-12
**Type:** Feature

## Summary

Added a two-layer credential scrubber so that secret API keys can never appear
in the sidecar's streamed log/event output, retained error buffers, or any text
that reaches the frontend. Layer 1 is a tested Python helper (`scrub_secrets`)
in the core package. Layer 2 is a pure-Rust chokepoint in the Tauri streaming
line loop applied before every `emit()` and every `push_back()` into the
`recent_lines` / `recent` error-classification buffer.

## Changes

- Created `src/gapmap/core/scrub.py` — conservative `scrub_secrets(text)` with
  8 compiled regex patterns covering sk-/sk-ant-/sk-or-/sk-proj- (OpenAI family),
  gsk_ (Groq), xai- (xAI), AIza (Google), nvapi- (NVIDIA), gh[pos]_ (GitHub),
  `Authorization: Bearer <token>`, and generic `*api_key/*token/*secret/*password
  = <value>` including full prefix forms like `ANTHROPIC_API_KEY=`.
- Created `tests/test_scrub.py` — 4 pytest tests covering all prefix families,
  key=value + bearer forms, normal-prose passthrough, and None/empty inputs.
  All 4 pass.
- Modified `app-tauri/src-tauri/src/cli.rs` — added `fn scrub_secrets(line: &str)
  -> String` (no regex dep; manual prefix scan + kv name-suffix + value-prefix
  checks) and wired it into all 10 emit/push_back sites across:
  - `run_dev_python_streaming` — stdout task (push_back + emit) and stderr task
    (push_back + emit)
  - `run_cli_streaming` — sidecar loop (push_back + emit)
  - `run_cli_chat_streaming` — sidecar loop (emit)
  - `run_cli_stream_streaming` — sidecar loop (push_back + emit)
  - `run_cli_enrich_streaming` — sidecar loop (emit)
  Added 6 Rust unit tests in `mod scrub_tests`; all pass (`cargo test scrub`).
  Full 32-test suite passes with 0 regressions.

## Files Created

- `src/gapmap/core/scrub.py`
- `tests/test_scrub.py`
- `changelogs/2026-06-12_02_credential-scrubber.md`

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — `scrub_secrets` function + wiring at all
  emit/push_back sites in the four streaming commands
