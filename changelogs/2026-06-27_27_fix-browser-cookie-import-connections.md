# Fix: browser cookie import (Connections all "not connected")

**Date:** 2026-06-27
**Type:** Fix

## Summary

Every source in the Connections screen showed "not connected" and the **Connect
browser** action reported "No cookies found" even when logged in. Root cause: the
Chromium cookie extractor only looked at the single legacy path
`Chrome/Default/Cookies` — but Chrome 86+ moved the store to
`<Profile>/Network/Cookies`, and multi-profile users keep cookies under
`Profile 1`, `Profile 2`, … (the test machine has **5** Chrome profiles, so the
old code found **0** cookie DBs). Now the extractor scans every profile's modern
**and** legacy path across Chrome, Brave, and Edge, and failures explain exactly
what to do.

## Changes

- `sources/_cookie_extract.py`:
  - New `_chromium_cookie_dbs(base)` — discovers cookie DBs across `Default` +
    every `Profile N`, trying `Network/Cookies` (modern) then `Cookies` (legacy).
  - Unified `_chromium_family_cookies(browser, …)` over a `_CHROMIUM_BROWSERS`
    table (Chrome / Brave / **Edge** added) with each browser's Keychain service.
  - X-specific and generic readers now iterate all profiles; **Edge** added to
    the browser reader set.
  - New diagnostics: `required_cookies(source)` (e.g. twitter → auth_token, ct0)
    and `browsers_present()` (which browsers have a store on disk).
  - Removed the dead single-path `_CHROME_COOKIES_DB` / `_find_brave_cookies_db`.
- `research/reach_connections.py`:
  - `import_browser` failure message is now actionable — names the browsers
    checked, the cookies to paste, the Keychain-access caveat, and Cookie-Editor.
    Adds `need` / `browsers` / `login_url` to the response.
  - New `connect_help(source)` — required cookie names + login URL + present
    browsers, for proactive UI guidance.
- `tests/test_reach_connections.py`: updated two assertions for the improved
  message and for the (concurrently-added) public sources that are always
  "connected" with no login URL.

## Files Modified

- `src/openreply/sources/_cookie_extract.py`
- `src/openreply/research/reach_connections.py`
- `tests/test_reach_connections.py`
