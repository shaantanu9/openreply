# last30days Source Layer — Phase 1

**Date:** 2026-06-13
**Type:** Feature

## Summary

Added 8 new data-source adapters ported from the `last30days` skill —
Polymarket, Truth Social, Digg, TikTok, Instagram, Threads, Pinterest, and
X/Twitter — wired into the existing collect pipeline, configurable from the
Settings BYOK modal, and gracefully skipped when their key/binary is missing.
Free sources (Polymarket, Digg, Truth Social, and X via browser cookies) work
with zero config; paid ones (ScrapeCreators for TikTok/Instagram/Threads/
Pinterest, xAI/Xquik for X) are entered in Settings and silently skip when the
key is empty. Each adapter emits the common posts-row shape, so dedup, graph,
and research extraction work unchanged. 31 new tests pass; `cargo check` clean.

This is Phase 1 of 3. Phase 2 (entity-resolution + engagement/"Best Takes"
scoring + cross-source cluster merge) and Phase 3 (recency-brief UI + ELI5 +
shareable HTML) are tracked in
`docs/superpowers/specs/2026-06-13-last30days-sources-phase1-design.md`.

## Changes

- 8 new `fetch_<name>` source adapters following the posts-row contract, each
  returning `[{"_error": ...}]` (filtered downstream) when unconfigured.
- Shared ScrapeCreators request helper (`_scrapecreators.py`) for the 4 IG-family
  sources (one key, `x-api-key` header).
- Stdlib-only browser cookie extraction (`_cookie_extract.py`) for zero-config X
  auth (Safari/Chrome/Brave/Firefox → `auth_token`/`ct0`), non-fatal on failure.
- X adapter with a 4-backend resolution chain: cookie-extract → bird (vendored
  Node client) → xAI (`api.x.ai`) → Xquik; first backend with rows wins.
- Registered all 8 in `collect_adapter.SOURCES` (56 → 64) and `sources/__init__.py`.
- Surfaced in the collect UI source picker (opt-in; intentionally NOT added to
  `AGGRESSIVE_SOURCES` so users aren't surprise-billed or stalled on missing keys).
- 6 new BYOK keys (`SCRAPECREATORS_API_KEY`, `TRUTHSOCIAL_TOKEN`, `AUTH_TOKEN`,
  `CT0`, `XAI_API_KEY`, `XQUIK_API_KEY`) wired through `commands.rs`
  (`ALLOWED` + `byok_status`) and `byok.js` (modal rows). Status-JSON keys aligned
  across Rust and JS.

## Files Created

- `src/gapmap/sources/polymarket.py`, `truthsocial.py`, `digg.py`, `tiktok.py`,
  `instagram.py`, `threads.py`, `pinterest.py`, `x_twitter.py`
- `src/gapmap/sources/_scrapecreators.py`, `_cookie_extract.py`
- `src/gapmap/sources/vendor/bird-search/` (vendored MIT Node client)
- `tests/test_polymarket.py`, `test_truthsocial.py`, `test_digg.py`,
  `test_tiktok.py`, `test_instagram.py`, `test_threads.py`, `test_pinterest.py`,
  `test_x_twitter.py`, `test_cookie_extract.py`, `test_scrapecreators_helper.py`,
  `test_new_sources_registered.py`
- `docs/superpowers/specs/2026-06-13-last30days-sources-phase1-design.md`
- `docs/superpowers/plans/2026-06-13-last30days-sources-phase1.md`
- `changelogs/2026-06-13_01_scrapecreators-shared-helper.md`,
  `_02_browser-cookie-extraction-x-auth.md`, `_03_register-8-last30days-sources.md`

## Files Modified

- `src/gapmap/sources/__init__.py` — exports for the 8 new fetchers
- `src/gapmap/sources/collect_adapter.py` — `run_*` wrappers + `SOURCES` entries
- `app-tauri/src/screens/collect.js` — 8 source-picker labels (both label maps)
- `app-tauri/src/screens/byok.js` — 6 BYOK key rows
- `app-tauri/src-tauri/src/commands.rs` — 6 keys in `ALLOWED` + `byok_status`
