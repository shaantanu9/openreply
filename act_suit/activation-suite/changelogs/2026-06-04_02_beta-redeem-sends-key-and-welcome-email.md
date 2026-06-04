# Beta key issuance now emails the license key + welcome

**Date:** 2026-06-04
**Type:** Fix

## Summary

Founding-member beta signups were not receiving any email when their
activation key was auto-issued. The dashboard auto-redeems the invite code a
user signs up with by calling `POST /api/v1/coupon/redeem`, but that route
never sent the license-key or welcome email — unlike `POST /api/v1/licence/free`
which does. Because the beta flow always goes through `coupon/redeem` (never
`licence/free`), founders got "key generated, no email." This wires the two
existing Resend emails (`sendLicenseKeyEmail`, `sendWelcomeEmail`) into the
redeem success path.

## Root cause / findings

- `mailer_autoconfirm: true` on the Supabase project → no Supabase confirmation
  email is sent on signup (this is intentional, so beta users can log in
  immediately). That left no "user created" email at all.
- `/api/v1/coupon/redeem` minted the key but returned without emailing it. The
  full key is only shown once in the UI, so users who didn't copy it had no
  record of it.
- Supabase SMTP (`smtp.resend.com`, `noreply@tool.myind.ai`) and the Resend
  transactional key are correctly configured both locally and on the live
  Vercel deploy (`RESEND_API_KEY_TOOL_MAIL` + `EMAIL_FROM` present in
  Production; sending domain `tool.myind.ai` is verified). So the only gap was
  the missing code path — no env change required.
- Plain login (`signInWithPassword`) sends no email by design (confirmed as
  intended).

## Changes

- On a successful redeem, await `sendLicenseKeyEmail(email, activationKey)` and
  surface `emailed: <bool>` + an "We also emailed it to you." suffix in the
  response message.
- Fire-and-forget `sendWelcomeEmail(email)` on the same path (first key
  issuance), matching the `licence/free` behaviour.
- Email failures are caught and logged; they never block the redeem response.
- Email address is taken from the verified Supabase bearer token, never the
  request body.

## Files Modified

- `src/app/api/v1/coupon/redeem/route.ts` — import `sendLicenseKeyEmail` /
  `sendWelcomeEmail`; send both after a successful redemption; add `emailed`
  to the JSON response.
