# Faster first collect — prewarm the LLM on app launch

**Date:** 2026-06-02
**Type:** Fix / Performance

## Summary

Users reported the first topic search "feels broken — log appears but nothing
gets fetched." Investigation (systematic debugging) showed collect actually
works (fetched 313 posts in a test); the problem is the **first-run LLM topic
canonicalization is a cold-model call (30-60s) that blocks the whole collect
before any source is fetched** — and the app never prewarmed the LLM on launch
(it prewarms the embedding/palace model + sidecar daemon, but not the LLM). So
the user stared at one frozen "canonicalizing…" line for up to a minute.

Refuted along the way: the standalone-Python sidecar (v0.1.12) does HTTPS fine
(frozen test: httpx → google + arxiv both 200, certifi bundled, macOS system
cert present) — so the "no data fetched" perception was slowness, not a TLS/cert
or network break.

## Changes

- **New `research.discover.warm_llm()`** — fires a 1-token LLM completion to load
  the model. Fail-soft (no provider → `{ok: False}`), idempotent on a warm model.
- **CLI** `openreply research warm-llm --json`.
- **Tauri** `warm_llm` command (registered in `main.rs`).
- **`api.js`** `warmLlm()` wrapper.
- **`main.js`** fires `api.warmLlm()` FIRST in the app-start warm group (max lead
  time), so by the time the user runs their first collect the model is hot →
  canonicalize drops from 30-60s to a few seconds.

## Files Modified

- `src/openreply/research/discover.py` (`warm_llm`)
- `src/openreply/cli/main.py` (`research warm-llm`)
- `app-tauri/src-tauri/src/commands.rs`, `main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/main.js`

## Validation

- `warm_llm()` returns `{ok: True}` in 1.2s (0.3s warm). CLI works. `cargo check`
  0 errors. JS `node --check` passes.

## Still to do (the "feels working" levers — bigger changes, not yet done)

- **P1 Parallel fetch:** start fetching free sources (HN/arXiv/…) with the typed
  topic IN PARALLEL with canonicalization, so posts land within seconds instead
  of after the canonicalize completes. Reddit discovery still needs the canonical
  keywords, but free sources don't — this is the strongest "instantly working"
  signal.
- **P2 Loader reframe:** label the canonicalize phase "Warming up · one-time
  ~30s" with the existing elapsed timer + recon preview, so the unavoidable wait
  reads as purposeful.
