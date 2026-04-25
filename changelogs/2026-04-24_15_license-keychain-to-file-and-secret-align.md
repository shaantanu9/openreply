# Licence: file-based token store + align desktop/server JWT secret

**Date:** 2026-04-24
**Type:** Fix

## Summary

Two activation bugs fixed:

1. **macOS was prompting for the login password on every app launch** to unlock the `gapmap-license` Keychain entry. Every dev rebuild re-signs the binary with a new code-sign identity, which invalidates the ACL of the Keychain item — so `security` asks the user to re-grant access. Fix: stop using Keychain; store the activation JWT in a 0600-permissioned file (`license_token`) in the app's data dir, alongside `device_id` which already lives there.

2. **Re-activating on the same device threw `invalid activation token: InvalidSignature`.** The activation server was signing tokens with `TOKEN_SIGNING_SECRET=replace_with_a_long_random_at_least_32_chars_for_prod` (the placeholder from `.env.example`), while the desktop binary was verifying with `dev-local-jwt-secret-change-before-release-0123456789` (the `build.rs` debug fallback, used because `JWT_DESKTOP_SECRET` was never exported at build time). HS256 tokens from one don't verify under the other. Fix: align both sides to the same secret.

## Changes

### Bug 1 — file-based token storage

- Removed `use keyring::Entry;` import in `commands.rs` (crate stays in `Cargo.toml` for now; can be deleted later).
- Replaced `LICENSE_TOKEN_SERVICE` / `LICENSE_TOKEN_ACCOUNT` constants with `LICENSE_TOKEN_FILE = "license_token"`.
- Rewrote `save_access_token(app, token)` / `read_access_token(app)` / `clear_access_token(app)` to read/write a plain file in `data_dir()` with `0600` perms on Unix (`std::fs::set_permissions` + `PermissionsExt`).
- Updated the three callers (`compute_activation_reason`, `license_activate`, `license_logout`) to pass `&AppHandle`.
- Updated the error string in `compute_activation_reason` from "missing from the keychain" to "missing from local storage".
- Kept the in-process `TOKEN_CACHE` Mutex — file reads are fast but the cache still collapses repeated reads-per-process to one.

### Bug 2 — secret alignment

- `act_suit/activation-suite/.env` — `TOKEN_SIGNING_SECRET` changed to `dev-local-jwt-secret-change-before-release-0123456789` with a comment explaining it must match the desktop binary's baked secret. Rotate both together for production.
- `app-tauri/.env` — added `JWT_DESKTOP_SECRET=dev-local-jwt-secret-change-before-release-0123456789` with instructions on how cargo picks it up at build time (doesn't auto-load dotenv; must be exported in the shell before `cargo tauri build`). The value matches the `build.rs` debug fallback so existing dev-mode binaries continue to work without a rebuild.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — keychain → file token storage (4 functions + 3 call sites updated).
- `app-tauri/.env` — added `JWT_DESKTOP_SECRET`.
- `act_suit/activation-suite/.env` — changed `TOKEN_SIGNING_SECRET` to match.

## Verification

- `cargo check` passes in `app-tauri/src-tauri` — no warnings beyond the existing `JWT_DESKTOP_SECRET missing` build-script note (which is harmless since the fallback now equals the intended value).
- The user's existing debug-build Tauri binary already embeds `dev-local-jwt-secret-change-before-release-0123456789` (confirmed via `target/debug/deps/gapmap-*.d`), so after restarting the Next.js activation server with the new env:
  1. New activation tokens verify cleanly (no more `InvalidSignature`).
  2. File-based token reads never prompt for the login password.

## Required Follow-up (One Command)

Restart the Next.js activation server so it picks up the new `TOKEN_SIGNING_SECRET`:

```bash
cd act_suit/activation-suite && PORT=3007 npm run dev
```

(Use whatever port the desktop UI has saved in localStorage under `gapmap.license.api_base` — the user reported port 3007; the `.env` default is 3434.)

## Security Trade-off

File-based storage is a reduction vs. Keychain: the JWT is now readable by any process running as the user, vs. gated by per-app ACL. Mitigations:
- File is `0600` (owner read/write only), same as `device_id` next to it.
- The token is a 180-day JWT tied to the device fingerprint — stealing it from another machine doesn't help (the desktop rejects tokens whose `device_fingerprint` claim doesn't match the local fingerprint, see `token_matches_device_fingerprint`).
- Server-side revoke (`/v1/license/revoke`) can invalidate a leaked token.

For the primary threat model (solo user's own Mac), the UX win of "no more scary login password prompt" outweighs the marginal security loss. Production builds that want Keychain back can re-introduce it behind a `cfg(feature = "keychain")` flag.
