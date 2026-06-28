# Fix the in-app licence activation flow (dead `#/activate` route, API base, optional password)

**Date:** 2026-06-03
**Type:** Fix / UI Enhancement

## Summary

The desktop app's licence-key UI lives in **Settings → "Licence & activation"**
(`LicenceCard.js`), and the MCP gate + onboarding copy send users there via
`#/activate`. But there was **no `/activate` route** in the router, so every
"Activate this device" button dead-ended on a blank/stale screen. Additionally the
card hardcoded the production API base (so a dev/local build couldn't activate against
a local server) and forced a password even though the server authenticates on
`(email, activation key)` and ignores the password value. This makes the whole
activate/renew flow actually work and matches the simplified "key is the secret" model
of the website.

## Changes

- **New `#/activate` route** (`src/main.js`): renders the Settings screen, then scrolls
  the Licence card into view, expands its form, and focuses the key input (polls for the
  async-mounted card). Added `#/activate → settings` to `navKey()` so the nav highlights.
- **API base now resolves dynamically** (`LicenceCard.js`): uses
  `api.licenseDefaultApiBase()` (honours the `OPENREPLY_LICENSE_API_BASE` env in dev, prod
  constant otherwise) instead of a hardcoded `https://openreply.myind.ai`. The base field is
  also moved under an "(advanced)" label since it's prefilled correctly.
- **Password is now optional** (`LicenceCard.js`): only email + key are required; a
  harmless placeholder is sent when the password is blank (the server requires the field
  present but ignores its value for Supabase activation). Field reordered to
  email → key → password (optional) → API base (advanced).
- **Fixed stale gate copy** (`settings.js`): "Activate → Purchase history" → "Activate →
  Billing" to match the rebuilt website, and **added a `revoked` gate entry** so a
  server-revoked licence shows a clear "cancelled/refunded → renew & re-activate" message
  (the Rust gate now emits this reason code).

## Verification

- `node --check` on all 3 modified files: OK
- Full app JS test suite (`npm test`): 50/50 pass
- App running via `tauri dev` (matching secret, local API base); changes hot-reloaded
- Cross-app secret match verified (server token validates under app secret, 4/4)
- Live server loop (activate/validate/revoke/reactivate + device-limit/deactivate): 12/12

## Files Modified

- `app-tauri/src/main.js` — `/activate` route + `renderActivate()` + navKey entry
- `app-tauri/src/components/LicenceCard.js` — dynamic API base, optional password, field order
- `app-tauri/src/screens/settings.js` — Billing copy fix + `revoked` gate entry

## Files Created

- `changelogs/2026-06-03_01_app-activate-route-and-licence-card-flow-fixes.md` — this entry
