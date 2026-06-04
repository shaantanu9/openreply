# Simpler beta signup: single full name + confirm password; fix /activate dead-end

**Date:** 2026-06-03
**Type:** UI Enhancement | Fix

## Summary

Streamlined beta account creation and removed a confusing auth dead-end on the
sign-in page.

## Changes

### Simpler signup (`src/components/auth/SignInPanel.tsx`)
- Replaced the **First name + Last name** two-field grid with a single
  **Full name** input. `full_name` is stored in user metadata; `first_name` /
  `last_name` are derived from it (first token / remainder) for compatibility.
- Added a **Confirm password** field with live mismatch feedback (red border +
  "Passwords don't match") and validation in `handleRegister`; the submit button
  is disabled while the two passwords differ.
- Waitlist join now sends the single `fullName`.

### Fix /activate dead-end
- Removed the **Activate** link from the sign-in footer nav. `/activate`
  (`ActivatePanel`) is auth-gated — it redirects logged-out users back to
  `/sign-in`, so linking it from the public sign-in page created a bounce loop.
  Activation remains reachable after login (nav / dashboard). Footer now shows
  Home · Help.

### Beta-accurate copy
- Sign-in left panel bullets updated from the stale "Perpetual licence / own the
  version you buy" and "14-day Pro trial / no credit card" to
  "Founding access / keep your spot after beta" and "Free in beta / no card ·
  invite-only".

## Files Modified

- `src/components/auth/SignInPanel.tsx`

## Files Created

- `changelogs/2026-06-03_10_simpler-signup-fullname-confirm-pwd.md`
