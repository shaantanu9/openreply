# License Activation Gate + Onboarding + Settings License Panel

**Date:** 2026-06-27
**Type:** Feature

## Summary

Built the missing frontend layer for OpenReply's first-run flow on top of Gap
Map's already-present license backend. The app now hard-gates on launch: an
unactivated device is blocked on a full-screen activation screen until a valid
key is entered, then walks through a short onboarding wizard (profile + AI
provider/BYOK), then reaches the app. License status, refresh, and deactivate
are surfaced in Settings. No backend porting was needed — the Rust commands
(`license_activate`, `license_status`, `license_revalidate`,
`license_server_check`, `license_default_api_base`, `license_logout`,
`license_gate_status`) and the BYOK system already existed; only the OpenReply
SPA (`or/*`) lacked the wrappers, gate, and screens.

## Changes

- **License API wrappers** added to `or/api.js`: `licenseGateStatus`,
  `licenseStatus`, `licenseDefaultApiBase`, `licenseServerCheck`,
  `licenseActivate`, `licenseRevalidate`, `licenseLogout` — thin `call()`
  wrappers over the existing registered Rust commands.
- **First-run gate** in `main.js`: new `gateCheck()` resolves the effective
  route. Fails closed — any error forces the activation screen. Honors
  `OPENREPLY_LICENSE_GATE_ENABLED` (gate off → no blocking). `activate`/`welcome`
  render full-screen (sidebar hidden). Browser-only (no Tauri) skips the gate
  so the static prototype still renders.
- **Activation screen** (`renderActivate` in `or/dynamic.js`): email +
  password + activation key (auto-formats to `XXXX-XXXX-XXXX-XXXX`, validates
  16 chars A–Z/2–9) + advanced API-base override (prefilled from
  `licenseDefaultApiBase`). Runs `licenseServerCheck` then `licenseActivate`;
  maps backend errors to human messages (`humanLicenseError`). On success →
  `#/welcome`.
- **Onboarding wizard** (`renderWelcome`): step 1 profile (name; email
  prefilled from license), step 2 AI provider + BYOK key (reuses
  `byokStatus`/`byokSet`/`testLlm`). Finish sets `or-onboarded` → `#/agents`.
- **Settings › License card** (`buildLicenseCard`, wired into `renderSettings`
  as a full-width card): shows email, plan, license id, expiry + days-left,
  trial end; Refresh (`licenseRevalidate`) and Deactivate (`licenseLogout` →
  back to `#/activate`).

## Files Created

- `docs/superpowers/specs/2026-06-27-license-onboarding-flow-design.md` — design spec
- `changelogs/2026-06-27_13_license-onboarding-activation-flow.md` — this entry

## Files Modified

- `app-tauri/src/or/api.js` — added 7 license command wrappers
- `app-tauri/src/main.js` — `gateCheck()` + full-screen route handling in `render()`
- `app-tauri/src/or/dynamic.js` — `renderActivate`, `renderWelcome`,
  `buildLicenseCard`, `fmtKey`, `humanLicenseError`; license card wired into
  `renderSettings`; `activate`/`welcome` registered in `DYN`
