# Transactional emails: personalised greeting + mobile-responsive

**Date:** 2026-06-04
**Type:** UI Enhancement

## Summary

The license-key and welcome emails now greet the recipient by first name and
adapt to phone screens. Previously they opened with a generic "Your license
key…" / "You just joined…" and used desktop-only padding/type sizes that were
heavy on small screens.

## Changes

- **Personalisation:** the recipient's name (from Supabase signup metadata
  `full_name` / `first_name`) is threaded into both emails.
  - License-key: lead line + plaintext now read "Hi {First}, your Pro license
    key…" (falls back to "Your…" when no name).
  - Welcome: heading copy + plaintext now read "Welcome, {First}!" / "Welcome,
    {First} — you just joined…" (falls back to the generic copy).
  - Names are HTML-escaped (`esc`) and reduced to the first token (`firstName`).
- **Responsive:** added a shared `HEAD` with a `@media (max-width:600px)` block
  plus `x-apple-disable-message-reformatting` / `color-scheme` meta. Key
  elements carry `gm-*` classes (`gm-pad`, `gm-card`, `gm-h1`, `gm-lead`,
  `gm-key`, `gm-btn`, `gm-stat`) that tighten padding and shrink large type on
  phones. Desktop + Outlook keep the existing inline styles (media queries are
  additive), so nothing regresses where `<style>` is ignored.
- `sendLicenseKeyEmail` gained `details.name`; `sendWelcomeEmail(to, name?)`
  gained the optional name. Both call sites (`coupon/redeem`, `licence/free`)
  pass the name pulled from the verified session's `user_metadata`.

## Files Modified

- `src/lib/email.ts` — `HEAD` constant + media query, `esc` / `firstName`
  helpers, personalised greetings in both emails, `gm-*` responsive classes,
  `name` on `LicenceDetails` and `sendWelcomeEmail`.
- `src/app/api/v1/coupon/redeem/route.ts` — read name from `user_metadata`,
  pass to both emails.
- `src/app/api/v1/licence/free/route.ts` — read name from `user_metadata`,
  pass to both emails.
