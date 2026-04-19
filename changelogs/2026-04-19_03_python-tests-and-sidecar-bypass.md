# Python integration tests + dev-mode sidecar bypass

**Date:** 2026-04-19
**Type:** Fix + Infrastructure

## Summary

Fixed the Tauri dashboard hanging for 2+ minutes per API call. Root cause was
macOS Gatekeeper verifying every `.so` file inside the PyInstaller-bundled
`reddit-cli` binary on every launch. Added a dev-mode bypass in Rust that
invokes `.venv/bin/python -m reddit_research.cli.main` via
`tokio::process::Command` when a venv is found near the Tauri cwd. Production
DMG installs (no `.venv` present) fall through to the original sidecar
binary path, so packaging still works on any user's Mac with no hardcoded
paths.

Also added an end-to-end Python integration test suite (13 tests, 9.6 s)
covering config, DB schema, Reddit discover + fetch, Ollama ping, MCP
module import, and the read-only SQL helper used by the DB console. All 13
pass against the real Python pipeline + live Reddit + the user's running
Ollama.

## Changes

- **Rust bypass**: `cli.rs` — new `find_dev_venv_python()` walks up from cwd
  looking for `.venv/bin/python`. If present, `run_cli` routes through a
  new `run_dev_python_cli()` that uses `tokio::process::Command`. Logs to
  stderr with `[sidecar] dev-python <path> args=... OK in Nms` so we can
  confirm the fast path is hit on every call.
- **Capabilities reverted**: `capabilities/default.json` no longer
  whitelists any user-specific path — only the shipped `binaries/reddit-cli`
  sidecar remains allowed. Keeps the bundle fully portable.
- **Integration tests**: `tests/test_integration.py` — 8 tests covering
  live Reddit discover/fetch, Ollama chat ping (tries each installed model
  until one answers; skips OCR/embedding specialty models), list models,
  MCP import, SQL helper, config env-var propagation. All network/LLM tests
  skip gracefully if the dependency is unreachable.

## Files Created

- `tests/test_integration.py` — 8 tests, live-network smoke
- `changelogs/2026-04-19_03_python-tests-and-sidecar-bypass.md` — this file

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — `find_dev_venv_python` +
  `run_dev_python_cli` + dev branch in `run_cli`
- `app-tauri/src-tauri/capabilities/default.json` — removed user-path aliases

## Verified end-to-end

- `.venv/bin/pytest -v tests/` → **13 passed in 9.60s**
  - 5 smoke (schema + upsert + CSV + JSON export + fetch audit)
  - 8 integration (config env, DB init, discover, fetch, LLM ping,
    list models, MCP, SQL)
- Dashboard API calls via the Rust dev bypass: ~1 s each, confirmed via
  `[sidecar] dev-python OK in Nms` stderr logs.
