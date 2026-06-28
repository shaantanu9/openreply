# Sync trial expiry across website + desktop; email key + welcome on free issuance

**Date:** 2026-06-03
**Type:** Fix

## Summary

Two licence-flow bugs:

1. **Trial date mismatch** — the website showed the real trial end (signup + 14
   days, e.g. June 17) but the desktop app showed **Nov 29**. Root cause: device
   activation returned `expires_at: license.expires_at || defaultActivationExpiryIso()`.
   Free trials store the date in `trial_ends_at` with `expires_at = null`, so the
   fallback stamped the generic **+180-day** default and never looked at
   `trial_ends_at`. The desktop also hardcoded `is_trial:false, trial_ends_at:None`
   at activation, so it never reflected the trial even though `/v1/licence/validate`
   already returns the right metadata.

2. **Free-key email** — the key email only fired on first mint and any failure was
   silently swallowed; no welcome/tracking email was sent.

## Changes

### Trial expiry sync
- **Server** (`supabaseActivationStore.ts`, `activationStore.ts`): both activate
  functions now return `expiresAt = expires_at ?? trial_ends_at ?? default` plus
  `isTrial` + `trialEndsAt` (added to the result types and all 6 success returns).
- **Server routes** (`api/v1/device/activate`, `v1/device/activate`): activation
  response now includes `is_trial` + `trial_ends_at` (master token → false/null).
- **Desktop** (`commands.rs`): `ActivateResponse` now parses `is_trial`,
  `trial_ends_at`, `plan_id`; `license_activate` stores them (was hardcoded
  false/None) and returns them. `license_revalidate` already synced these from
  `/validate`, so trial state stays correct over time. The licence card
  (`LicenceCard.js`) already renders `is_trial`/`trial_ends_at`, so it now shows
  "Trial ends <real date>" matching the website.

### Free-key email
- `api/v1/licence/free`: on first issuance, send the key email AND a welcome
  email (`sendWelcomeEmail`); log send failures to the server console instead of
  silently dropping them (the response already returns `emailed`).

## Verification

- `npx tsc --noEmit` (activation-suite) → no type errors.
- `cargo check` (app-tauri/src-tauri) → clean.
- Resend send verified live (HTTP 200, domain `tool.myind.ai` verified).

## Files Modified

- `act_suit/activation-suite/src/lib/supabaseActivationStore.ts`
- `act_suit/activation-suite/src/lib/activationStore.ts`
- `act_suit/activation-suite/src/app/api/v1/device/activate/route.ts`
- `act_suit/activation-suite/src/app/v1/device/activate/route.ts`
- `act_suit/activation-suite/src/app/api/v1/licence/free/route.ts`
- `app-tauri/src-tauri/src/commands.rs`
