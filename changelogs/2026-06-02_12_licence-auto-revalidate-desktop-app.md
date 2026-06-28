# Desktop app: automatic licence re-validation (renewals & revocations sync without re-activating)

**Date:** 2026-06-02
**Type:** Feature

## Summary

Until now the desktop app verified its licence JWT **locally only** — it never
re-contacted the server after the first activation. So a **renewal** (extended
`expires_at`) or a server-side **revocation/refund** never took effect until the
user manually re-entered their key. This adds a `license_revalidate` command that
re-checks the licence against the server, syncs the result locally, and runs on a
timer (boot + every 6 h) plus on app boot from the frontend.

The website counterpart (the `/v1/licence/validate` alias + an enriched response that
returns the current `expires_at`) is in the `act_suit/activation-suite` repo.

## How it works

- **Valid** → store the latest `expires_at` (and any `refreshed_token`, verified +
  device-bound before persisting), clear the `revoked` flag → a renewal unlocks the
  app automatically.
- **Revoked / 401 / not-valid** → set a new `revoked` flag on the local licence state →
  the launch gate (`compute_activation_reason`) locks the app on the next check.
- **Offline / network error** → leave cached state untouched (offline grace; never lock
  someone out for being on a plane).

## Changes

- `src-tauri/src/commands.rs`:
  - `LicenseState` gains a `#[serde(default)] revoked: bool` field (backward-compatible —
    older `license_state.json` files load as `false`).
  - New `#[tauri::command] license_revalidate(app)` — POSTs the stored token + device
    fingerprint to `{api_base}/v1/licence/validate`, then syncs expiry/token or sets
    `revoked` per the rules above.
  - `compute_activation_reason` now returns a `revoked` reason (priority over the local
    expiry check) so a cancelled licence locks even before its stored expiry passes.
  - Fixed the stale gate copy ("Activate → Purchase history" → "Activate → Billing")
    to match the rebuilt website page.
- `src-tauri/src/main.rs`:
  - Registered `commands::license_revalidate` in the invoke handler.
  - Added a `setup()` background task: re-validate 12 s after boot, then every 6 h.
- `src/api.js`: added `licenseRevalidate()` (invalidates the cached `license_status`).
- `src/main.js`: `healActivationFlagsFromBackend()` fires a best-effort re-validation on
  boot so renewals/revocations sync immediately even for an already-activated machine.

## Verification

- `cargo check` (src-tauri): 0 errors (only the expected debug-fallback
  `JWT_DESKTOP_SECRET` warning).
- A full `npm run tauri build`/`dev` with the matching `JWT_DESKTOP_SECRET` is still
  required to ship — see manual step in the session summary.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`
- `app-tauri/src/main.js`

## Files Created

- `changelogs/2026-06-02_12_licence-auto-revalidate-desktop-app.md` — this entry
