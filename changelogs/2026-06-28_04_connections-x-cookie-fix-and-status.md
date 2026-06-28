# Connections: X cookie auto-import fix + connected-status visibility

**Date:** 2026-06-28
**Type:** Fix + UI Enhancement

## Summary

Two connection problems addressed: (1) X/Twitter cookie auto-import reporting
"not logged into this site" for a logged-in user, and (2) no obvious way to see
which accounts are connected.

## Changes

### X cookie auto-import (`sources/_cookie_extract.py`)
- **Read WAL sidecars.** The snapshot copied only the main `Cookies` SQLite, not
  its `-wal` sidecar. A running browser keeps freshly-written cookies (e.g. a
  login from the current session) in the WAL until it checkpoints — so a
  logged-in user's session cookie could be invisible → 0 rows → false "not
  logged in." Now copy `<db>-wal`/`-shm` alongside (same base name) so SQLite
  applies the WAL on open, and clean them up after. Applies to both Chromium and
  Firefox extraction paths.
- **Actionable diagnosis.** The 0-rows message now reads: "browser found, but no
  saved login cookie for this site — log in, then FULLY quit & reopen the browser
  and retry (Safari isn't supported)."

### Connected-status summary (`app-tauri/src/or/dynamic.js`)
- New banner at the top of the **Connections** screen:
  "✓ N accounts connected: Reddit · LinkedIn · M public sources active"
  (or a connect prompt when none). The per-card green badge was easy to miss;
  this makes active logins obvious at a glance.

## Verification

- Cookie module parses; `extract_cookies("reddit")` still returns cookies;
  `extract_cookies("twitter")` returns the improved diagnosis on a machine where
  X isn't logged in via a Chromium browser.
- `browsers_present()` on this machine = chrome, brave, safari — confirming the
  X login is likely in Safari (httpOnly cookies in Safari's binary container
  aren't externally readable → manual paste is the path there).
- `list_connections()` confirms Reddit + LinkedIn connected (verified
  2026-06-27); the new banner surfaces them.

## Files Modified

- `src/openreply/sources/_cookie_extract.py`
- `app-tauri/src/or/dynamic.js`

## Files Created

- `changelogs/2026-06-28_04_connections-x-cookie-fix-and-status.md`

## Notes — how to connect X right now

- **Best:** log into **x.com in Chrome / Brave / Edge / Arc**, fully quit &
  reopen that browser, then click **Import** on the X card.
- **Safari users / fallback:** install the **Cookie-Editor** extension on x.com →
  **Export**, and paste `auth_token` + `ct0` into the X card's manual-paste box.
  This path already works end-to-end (stored locally, used by the X source).
