# Browser Cookie Extraction for X Auth

**Date:** 2026-06-13
**Type:** Feature

## Summary

Added `src/openreply/sources/_cookie_extract.py`, a stdlib-only helper that
extracts X/Twitter `auth_token` + `ct0` cookies from local browser stores
(Chrome, Brave, Firefox, Safari). All failures are non-fatal by design — a
locked database, missing permissions, or uninstalled browser returns `{}`/`None`
and never raises. This enables zero-config X search when the user is already
logged into x.com in any supported browser.

## Changes

- Ported Firefox SQLite reader (`_query_firefox_cookies_db`, profile-discovery
  logic) from last30days lib/cookie_extract.py, scoped to x.com/twitter.com
- Ported Chrome/Brave macOS v10 AES-128-CBC decryption via `security` + `openssl`
  CLI (no third-party deps)
- Ported Safari binary cookie parser (`_parse_safari_binary_cookies`, page/record
  structs) for macOS
- Added public API: `_extract_x_cookies_all_browsers() -> dict` and
  `x_auth_from_browsers() -> dict | None`
- Added 3 pytest tests covering the None path, the success path, and the
  never-raises contract

## Files Created

- `src/openreply/sources/_cookie_extract.py` — implementation (~280 lines, stdlib only)
- `tests/test_cookie_extract.py` — 3 tests, all passing

## Files Modified

- None
