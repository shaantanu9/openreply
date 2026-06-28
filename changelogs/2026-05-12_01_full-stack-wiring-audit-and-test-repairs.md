# Full-stack wiring audit + stale-test repairs

**Date:** 2026-05-12
**Type:** Fix

## Summary

End-to-end audit of the three-boundary architecture (JS frontend → Rust
Tauri commands → Python Typer CLI) after the audience/improve/iterate/
launch surface landed. Every boundary was diffed mechanically; no
wiring gaps found. Fixed 3 stale tests broken by API-shape drift and
test-isolation gaps, then re-ran the full suite green.

## Boundaries verified clean

- **JS → Rust:** 235 distinct `invoke()` / `cachedInvoke()` targets in
  the frontend; every one maps to a `#[tauri::command]` registered in
  `main.rs::generate_handler!`. Zero orphans.
- **Rust → Python:** 127 `run_cli(vec!["sub", "cmd", …])` call-sites
  in `commands.rs` / `cli.rs`; every subapp+command pair (including the
  3-token `research graph build|enrich|relate` triples) exists as a
  registered Typer command. Zero orphans.
- **Routes ↔ screens:** All 43 screens in `app-tauri/src/screens/`
  either have a direct route in `main.js::routes` (32 of them) or are
  loaded as tabs inside `topic.js` / `settings.js` (10 of them).
  Sidebar hrefs in `index.html` match the route table.
- **New Python modules:** `audience.py`, `deliberate.py`,
  `idea_scan.py`, `iterate.py`, `launch.py`, `pipeline.py`,
  `_clustering.py` all imported by `cli/main.py`. MCP server exposes
  `audience`, `deliberate`, `launch`, `pipeline` (idea_scan and iterate
  are UI-only flows by design).

## Smoke tests (all green)

- `python -m reddit_research.cli.main --help` and every subapp
  (`fetch`, `analyze`, `research`, `research graph`, `ingest`, `mcp`,
  `auth`, `whisper`, `ytdlp`) — no ImportError / lazy-import surprises.
- `cargo check` in `app-tauri/src-tauri/` — clean.
- `python -m reddit_research.cli.main health --json` — all 5 subsystem
  checks pass (data_dir, db with 52 tables, palace ONNX cached, LLM
  provider resolves to nvidia/llama-3.3-70b, reddit info-level).

## Stale tests repaired

1. **`tests/test_integration.py::test_discover_subs_returns_real_results`** —
   was still asserting `isinstance(result, list)` after `discover_subs`
   was reworked to return `{"subs": [...], "confirmation": {...}}` for
   the topic-canonicalization rework. Updated the test to unwrap the
   `subs` key and additionally assert the `confirmation` payload is a
   dict.

2. **`tests/test_integration.py::test_canonicalize_no_llm_passthrough`** —
   was deleting 7 hardcoded provider env vars but missed
   `NVIDIA_API_KEY` (added later in `_PROVIDER_ENV_KEY`). On any
   machine with NVIDIA configured in BYOK, `resolve_provider(None)`
   returned `"nvidia"` and the test got a real LLM-corrected canonical
   instead of the pass-through. Driven the cleanup off
   `provider_base._PROVIDER_ENV_KEY.values()` so adding a new provider
   keeps the test honest automatically.

3. **`tests/transcribe/test_models_catalogue.py`** — two tests for
   `default_tier()` (`test_default_tier_falls_back_to_default_when_nothing_installed`
   and `test_default_tier_ignores_stale_marker`) isolated
   `REDDIT_MYIND_DATA_DIR` but not `HF_HUB_CACHE` or
   `OPENREPLY_WHISPER_MODELS_DIR`. On a workstation with `tiny.en` already
   in the HuggingFace cache, `list_installed()` picked it up as
   externally-discovered, so `default_tier()` returned `tiny.en`
   instead of falling back to `DEFAULT_TIER=small.en`. Added the same
   env-isolation pair that `test_default_tier_reads_marker_file`
   already uses.

## Dead-code finding (left in place)

- `app-tauri/src/screens/home_tab.js` (26 lines, exports `loadHome`) —
  not referenced anywhere; the `home` tab in `topic.js` now points to
  `loadInsights`. Tracked but orphaned since the lifecycle/UI redesign.
  Safe to delete; left in place so the user can confirm intent first.

## Files Modified

- `tests/test_integration.py` — updated 2 assertions for new API
  shapes; switched provider-key cleanup to drive off the real provider
  table.
- `tests/transcribe/test_models_catalogue.py` — added `HF_HUB_CACHE` +
  `OPENREPLY_WHISPER_MODELS_DIR` isolation to two tests.

## Verification

- `python -m pytest tests/ -q` → **91 passed, 3 skipped** (Reddit creds
  absent, Ollama absent, slow tests).
- `cargo check` → clean (only the expected `JWT_DESKTOP_SECRET` warn).
- `health --json` → `ok: true` across all subsystems.
