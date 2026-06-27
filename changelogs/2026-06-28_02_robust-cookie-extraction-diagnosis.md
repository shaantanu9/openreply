# Robust cookie extraction + precise failure diagnosis

**Date:** 2026-06-28
**Type:** Fix

## Summary

Hardened browser cookie import (the "Connect browser" flow) after studying the
reference `last30days` implementation and the Chrome encryption format. Key
findings: (1) `last30days` is also v10-only — there was no v20 code to port;
(2) on macOS Chrome uses v10 + AES-128-CBC (which we handle), so empty results
were silent failures, not an algorithm gap. The fix makes extraction robust and,
crucially, makes it **say why** it failed so the user knows whether to log in,
allow Keychain, or paste manually.

## Changes (`sources/_cookie_extract.py`)

- **In-process AES via `cryptography`** (with `openssl` CLI fallback) — removes
  the fragile `openssl enc` shell-out that fails silently under macOS LibreSSL in
  the bundled sidecar. Proven by a decrypt round-trip test.
- **v20 / app-bound support** — AES-256-GCM `_decrypt_v20_value` + `Local State`
  `os_crypt.app_bound_encrypted_key` read (best-effort; macOS unwrap isn't
  publicly recoverable, so it reports the cause and steers to manual paste).
- **Per-attempt diagnosis** (`_DIAG` + `diagnose_last()`) — distinguishes: no
  cookie store / not-logged-in / v20-app-bound / Keychain-blocked / decrypt-failed.
- **More browsers**: added Vivaldi, Opera (flat layout), Arc, Chromium (was just
  Chrome/Brave/Edge).
- **Profile discovery**: mtime-sorted (Profile 10 no longer loses to Profile 2)
  and probes Opera's flat base layout.
- **Lazy Keychain fetch** — only prompts once a row actually needs decrypting.
- Reddit registry now also matches `token_v2` (modern auth cookie).

## Changes (`research/reach_connections.py`)

- `import_browser` failure message now uses `diagnose_last()` — e.g. "you're not
  logged into this site in it" or "macOS blocked Keychain access" — plus the exact
  cookies to paste. Adds `reason` to the response.

## Verification

- 28 cookie/credential tests pass, incl. a v10 AES round-trip and a full
  encrypted-cookie extraction with a mocked Keychain key.
- Real import now returns a precise reason (on this machine: "not logged into
  Reddit/X in the scanned browsers").

## Files Modified

- `src/gapmap/sources/_cookie_extract.py`
- `src/gapmap/research/reach_connections.py`
- `tests/test_cookie_extract_discovery.py`, `tests/test_reach_connections.py`
