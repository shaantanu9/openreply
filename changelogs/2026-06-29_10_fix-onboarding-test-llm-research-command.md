# Fix onboarding "No such command 'research'" — restore test-llm / list-models CLI

**Date:** 2026-06-29
**Type:** Fix

## Summary

Clicking **Test connection** in onboarding (after entering an LLM API key)
failed with `UsageError: No such command 'research'. Did you mean 'search'?`.
Root cause: the `research` Typer command group was removed during the Gap Map
strip, which also deleted the `research test-llm` and `research list-models`
commands (and the `research.chat.test_provider` helper they used). But the Rust
bridge still invoked `research test-llm --json` / `research list-models …`, so
the sidecar errored. Fixed by restoring both commands as **top-level** CLI
commands implemented against the live provider layer
(`openreply.analyze.providers.base`), and dropping the dead `research` prefix
from the two Rust commands.

## Changes

- `src/openreply/cli/main.py`: added top-level `test-llm` and `list-models`
  commands.
  - `test-llm` resolves the provider (`resolve_provider`), builds it
    (`get_provider`), runs a tiny `complete("Reply with exactly the word: OK")`
    and returns `{ok, provider, model, latency_ms, reply}` (or
    `{ok:false, provider, error}`) as `--json`.
  - `list-models` (Ollama-only) queries `OLLAMA_BASE_URL/api/tags` and returns
    `{ok, url, models:[{name,size_mb,param_size}]}`; degrades to
    `{ok:false, url, error}` when Ollama is unreachable (no crash).
- `app-tauri/src-tauri/src/commands.rs`:
  - `test_llm` now invokes `["test-llm", "--json", …]` (was
    `["research", "test-llm", …]`).
  - `list_ollama_models` now invokes `["list-models", …]` (was
    `["research", "list-models", …]`).

## Verification

- `.venv/bin/python -m openreply.cli.main test-llm --json`
  → `{"ok": true, "provider": "nvidia", "model": "meta/llama-3.1-8b-instruct", "latency_ms": 929, "reply": "OK"}`
- `list-models --provider ollama --json` with Ollama down
  → `{"ok": false, "url": "http://localhost:11434", "error": "…Connection refused"}` (clean, no traceback)
- `--help` now lists `test-llm` and `list-models`; no `research` group remains.

## Files Modified

- `src/openreply/cli/main.py` — restored `test-llm` + `list-models` commands
- `app-tauri/src-tauri/src/commands.rs` — dropped dead `research` prefix in
  `test_llm` and `list_ollama_models`

## Follow-up

- Requires a sidecar (PyInstaller) + Tauri app rebuild for the fix to reach the
  packaged/installed app, since the bundled `openreply-cli` is what runs in the
  shipped build.
