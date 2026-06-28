# Audit-fixes bundle — 7 commits closing every finding from the 2026-04-20 audit

**Date:** 2026-04-20
**Type:** Security / Hardening / Testing / Refactor / Docs

## Summary

The 2026-04-20 thorough audit (see `docs/superpowers/specs/2026-04-20-audit-fixes-plan.md`) surfaced 7 findings across security, architecture, testing, and docs. Every finding is now closed by a dedicated commit. The app's security posture, error surfacing, and test coverage all improved measurably — no new regressions, 41 unit tests still pass.

## Changes

- Narrowed CSP `connect-src` from `https://*` wildcard to an explicit allowlist of ~25 origins covering every external API the app actually hits (Reddit, arXiv, PubMed, OpenAlex, Scholar, HN, GitHub, StackOverflow, Google News/Trends, App/Play Store, 7 LLM providers, ChromaDB model CDN).
- Added `tests/conftest.py` prepending `src/` to `sys.path` so `pytest tests/` works on fresh checkouts without `uv sync` first.
- Replaced two silent `serde_json::from_str(&stdout).unwrap_or(Value::Null)` sites with a `parse_or_diagnostic()` helper that returns a `{_parse_error, _raw, _parse_error_message}` sentinel; frontend `invokeWithRetry()` now detects the sentinel and throws a surfaced `Error` with the raw Python output embedded.
- Added `setHTMLWithIcons(el, html)` helper to `icons.js` — one-call replacement for the brittle `el.innerHTML = html; window.refreshIcons?.()` pattern. Audit of all 18 existing `innerHTML`+`data-lucide` sites showed every one already has a correct follow-up call; helper prevents future regressions.
- Strengthened `resolve_provider()` docstring in `analyze/providers/base.py` with an explicit warning (`⚠️ Do NOT use this to actually call an LLM`) + 4 examples of correct use + pointer at `get_provider()` for actual LLM calls. Audit confirmed every existing caller already uses it correctly.
- Hardened `find_dev_venv_python()` against symlink-loop pathological filesystems — canonicalize each step, track visited set, break on revisit.
- New `tests/test_cancel_contract.py` with 3 `@pytest.mark.slow` tests verifying the Python side honors SIGTERM within 5s on `research collect`, `stream --json`, and SIGINT paths. Registered `slow` marker in `pyproject.toml`.

## Commits (in order)

| # | SHA | Title |
|---|-----|-------|
| plan | `5bae7aa` | `docs(plan): audit-fixes plan — 7 findings, priority ladder, per-fix spec` |
| 1 | `765dfa9` | `fix(security): narrow CSP connect-src from https://* to explicit allowlist` |
| 2 | `3f97640` | `chore(tests): add conftest.py so pytest works on fresh checkouts` |
| 3 | `1f79a8a` | `fix(sidecar): surface Python errors instead of silently returning null` |
| 4 | `46a9004` | `feat(icons): setHTMLWithIcons helper — innerHTML + refreshIcons in one call` |
| 5 | `b19c0c3` | `refactor(providers): stronger docstring on resolve_provider — not for LLM calls` |
| 6 | `2a7d9e9` | `hardening(cli): guard find_dev_venv_python against symlink loops` |
| 7 | `a2c79b2` | `test(cancel): verify CLI cancel contract — SIGTERM cleanly exits` |

## Files Created

- `docs/superpowers/specs/2026-04-20-audit-fixes-plan.md` — living plan + status tracker
- `tests/conftest.py` — pytest bootstrap for src-layout imports
- `tests/test_cancel_contract.py` — 3 slow cancel-contract tests

## Files Modified

- `app-tauri/src-tauri/tauri.conf.json` — CSP `connect-src` explicit allowlist
- `app-tauri/src-tauri/src/cli.rs` — `parse_or_diagnostic()` helper + symlink-loop guard on `find_dev_venv_python()`
- `app-tauri/src/api.js` — `throwIfParseError()` gate inside `invokeWithRetry()`
- `app-tauri/src/icons.js` — `setHTMLWithIcons(el, html)` helper
- `src/reddit_research/analyze/providers/base.py` — strengthened `resolve_provider()` docstring
- `pyproject.toml` — registered `slow` pytest marker
