# Fix CI failures — Python tests, MCP import, Rust externalBin

**Date:** 2026-05-17
**Type:** Fix

## Summary

The `ci` workflow was failing on the `python-check` and `rust-check` jobs (the
`js-check` job passed). Three independent root causes, all confirmed by reading
the CI logs and reproducing locally:

1. **Live-network tests ran in CI.** `test_discover_subs_returns_real_results`
   and `test_fetch_posts_writes_to_db` hit the live Reddit API. They were
   guarded only by `@pytest.mark.skipif(not REDDIT_OK)`, where `REDDIT_OK` is a
   TCP-socket reachability check. On a GitHub Actions runner the socket
   connects, so the guard passes — but Reddit returns `403 Blocked` to
   datacenter IPs. The test file's own docstring says these should be excluded
   via `-m "not slow"`, but the tests never carried the `slow` marker.

2. **`test_mcp_module_importable` failed instead of skipping.** CI installed
   only `.[dev]`, which omits `fastmcp` (in the `mcp` extra). `mcp/server.py`
   catches the `ImportError` for `fastmcp` and re-raises it as
   `RuntimeError("Install the mcp extra ...")`. The test only caught
   `ImportError`, so the `RuntimeError` propagated as a failure.

3. **`cargo check` failed on a missing `externalBin` path.** `tauri-build`
   (run from `build.rs`) validates that every `externalBin` path exists — even
   during `cargo check`. CI never has the sidecar binaries (gitignored build
   artifacts), so the check failed with
   `resource path 'binaries/reddit-cli-aarch64-apple-darwin' doesn't exist`.
   Reproduced locally by moving the binaries aside; fixed by stripping
   `externalBin` before `cargo check` (verified: `cargo check` then succeeds
   with the binaries absent).

## Changes

- `tests/test_integration.py`: added `@pytest.mark.slow` to the 4 live-network
  tests (`test_discover_subs_returns_real_results`, `test_fetch_posts_writes_to_db`,
  `test_ollama_ping_ok`, `test_list_ollama_models`) so CI's `-m "not slow"`
  deselects them. Local CI-profile run: **87 passed, 7 deselected, 0 failed**.
- `tests/test_integration.py`: `test_mcp_module_importable` now catches
  `(ImportError, RuntimeError)` and skips on a message mentioning `fastmcp` or
  `mcp extra` — matching what `server.py` actually raises.
- `.github/workflows/ci.yml` (`python-check`): install `.[all]` instead of
  `.[dev]` so the suite can import the MCP server, source adapters, retrieval
  and docs deps for real.
- `.github/workflows/ci.yml` (`rust-check`): added a step that sets
  `bundle.externalBin = []` in `tauri.conf.json` before `cargo check`, since
  the binaries are gitignored artifacts and `cargo check` does not bundle.

## Files Created

- `changelogs/2026-05-17_05_fix-ci-failures.md`

## Files Modified

- `tests/test_integration.py` — `slow` markers on live tests; broader except in the MCP import test
- `.github/workflows/ci.yml` — `.[all]` install; strip `externalBin` before `cargo check`
