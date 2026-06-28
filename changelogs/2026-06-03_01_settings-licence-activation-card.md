# Desktop app: Settings → Licence & activation card (add key, renew, sign out)

**Date:** 2026-06-03
**Type:** Feature

## Summary

The desktop app let you enter a licence key **only during onboarding**
(`welcome.js`). After that there was no way to add a key, see your licence
status, renew it, or switch keys — even though the MCP activation gate and the
onboarding copy both told users to go to "Settings → Licence" / "#/activate".
Neither that settings section nor the `#/activate` route existed, so those
calls-to-action dead-ended.

This adds a real **Licence & activation** card to Settings that is the
destination those links always promised. It shows the current licence status
and lets the user activate a key, re-check/renew it, switch to a different key,
or sign the licence out — all after onboarding.

## How it works

- A new `src/components/LicenceCard.js` renders a full-width Settings card
  (`#card-licence`, sits right after the profile card).
- On mount it calls `api.licenseStatus()` and renders:
  - A status badge — **Active / Renews in Nd / Expired / Revoked / Other device
    / Not activated** (mirrors `commands.rs::compute_activation_reason`).
  - Detail rows: account email, licence id, renews/expires date, last checked,
    this-device signature.
- **Activated users** get: *Re-check / renew* (`license_revalidate`), *Manage /
  renew on website* (opens `<api_base>/activate`), *Use a different key* (reveals
  the form), and *Sign out of licence* (`license_logout`).
- **Not-activated / expired / revoked** users get the activation form (API base,
  email, password, key) → `license_activate`, plus *Test server*
  (`license_server_check`), *Get a key — sign up*, and *Redeem a coupon* links.
- On successful activation it sets the `openreply.license.*` localStorage keys the
  boot gate reads and best-effort bootstraps MCP clients, then re-renders.
- The dev/local server base is resolved via `license_default_api_base` so a dev
  build can activate against a local server instead of hardcoding prod.

The MCP activation-gate CTA in Settings (previously `href="#/activate"`, a dead
route) now scrolls to this card, opens the form, and focuses the key field.

## Files Created

- `src/components/LicenceCard.js`
- `changelogs/2026-06-03_01_settings-licence-activation-card.md`

## Files Modified

- `src/screens/settings.js` — import + insert the licence card skeleton, mount it, and repoint the activation-gate CTA to the card.

## Verification

- `node --check` on both files — OK.
- `npm test` — 50/50 pass.
- `npm run build` (Vite) — built successfully; module bundles cleanly.
