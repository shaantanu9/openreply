# In-process cache for the activation-token keychain read

**Date:** 2026-04-24
**Type:** Fix / UX / Privacy-feel

## Summary

Every Settings → MCP card open + every `mcp_*` command fired
`read_access_token()`, which hit the macOS keychain and triggered the
*"gapmap wants to use your confidential information stored in
'gapmap-license'"* prompt repeatedly. In dev the ACL never matches
(each rebuild produces a new ad-hoc signature), so users saw that
dialog over and over — it reads as a privacy breach even though we're
always pulling the same one JWT we wrote ourselves.

Added a process-level cache so the keychain is touched exactly **once
per app launch**. The cache is seeded on successful writes and cleared
on deactivate, so correctness is preserved — the JWT's own `expires_at`
remains the authoritative expiry check (still enforced by
`compute_activation_reason`).

## Changes

- **`TOKEN_CACHE: Mutex<Option<Option<String>>>`** at module scope in
  `commands.rs`. Three-state:
  - `None` — never attempted.
  - `Some(None)` — negative result cached (no token set; doesn't re-prompt).
  - `Some(Some(t))` — token value cached.
- **`read_access_token()`** now checks the cache first; only hits the
  keychain on cold read, then memoises the result (positive or negative).
- **`save_access_token(t)`** seeds the cache with the fresh value after
  the keychain write succeeds.
- **`clear_access_token()`** flips the cache to `Some(None)` so
  subsequent reads don't try the keychain until the user re-activates.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — added `TOKEN_CACHE` static and
  cache reads/writes in the three helpers.

## Files Created

- `changelogs/2026-04-24_09_keychain-token-read-cache.md`

## Verification

- `cargo check` → clean.
- Manual repro: before, opening Settings → MCP and then clicking
  Re-sync fired the keychain prompt twice. After, you see the prompt
  **once per app launch** (to do the initial read), then never again
  for the rest of that session regardless of how many MCP commands run.
- Re-activation still works end-to-end because `save_access_token`
  re-seeds the cache with the freshly-minted token the web API returns.
- Deactivation still works because `clear_access_token` flips the cache
  to negative, so subsequent reads return `None` without a keychain hit.

## Security note

The cache holds the token in this process's heap for the app's
lifetime. That's the same exposure profile as the existing
`LicenseState` struct (which also carries `access_token`) — no new
surface. When the app quits, the cache goes with it; next launch
re-reads from the keychain once.
