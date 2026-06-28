# Connections: guided cookie paste + discovery tests

**Date:** 2026-06-27
**Type:** Fix / UI Enhancement

## Summary

Follow-up to the browser-cookie-import fix. Browser auto-import now discovers
cookies correctly, but modern Chrome (127+) app-bound `v20` encryption and macOS
Keychain gating mean auto-import can still come up empty on some machines. The
reliable path is manual paste — so this makes it foolproof: the paste modal now
tells you exactly which cookies to copy (e.g. `auth_token`, `ct0`), links the
login page, and spells out the Cookie-Editor steps. Also adds synthetic-DB tests
proving the multi-profile / `Network/Cookies` discovery + extraction works
end-to-end.

## Changes

- `research/reach_connections.py`: `list_connections()` now includes `need` —
  the exact session-cookie names for each cookie source — so the UI can show a
  precise paste hint.
- `or/dynamic.js` (Connections paste modal): shows "Copy these cookies: …",
  an "open <site> login ↗" link, numbered Cookie-Editor steps, and a smart
  `name=…; name2=…` placeholder built from the source's required cookies.
- `tests/test_cookie_extract_discovery.py` (new): builds a synthetic Chromium
  profile tree (real SQLite cookie DBs) and asserts discovery across
  `Default` + `Profile N` and `Network/Cookies` + legacy `Cookies`, plus
  multi-cookie extraction (verified: LinkedIn `li_at` + `JSESSIONID`).

## Verification

- Manual paste confirmed: stores the credential and flips the card to connected.
- 15 reach/cookie tests pass; frontend `vite build` clean.

## Files Created

- `tests/test_cookie_extract_discovery.py`

## Files Modified

- `src/openreply/research/reach_connections.py`
- `app-tauri/src/or/dynamic.js`
