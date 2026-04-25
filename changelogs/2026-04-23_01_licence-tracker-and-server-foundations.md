# Licence Tracker & Server Foundations

**Date:** 2026-04-23
**Type:** Feature + Infrastructure + Documentation

## Summary

Audited the `docs/licence/tauri-licence-impl.md` spec against the three relevant
codebases (`app-tauri/`, `act_suit/activation-suite/`, `act_suit/html_site/`),
created a tracker MD documenting the full phased scope, and landed Phases A–D
server-side: full JWT claim shape, deactivate + validate routes, safe-alphabet
activation keys, hardened dev-mint, companion `subscription-model.md`, and the
Supabase migration that backs the new plan columns.

Phase G (desktop Stronghold + feature gates + module refactor) and Phase F
(Lemon Squeezy webhook) remain open; see the tracker.

## Changes

- Removed hardcoded `TOKEN_SIGNING_SECRET` fallback; server now fails hard on
  missing/short secrets — prevents silent signature drift from the desktop.
- Expanded JWT claims to full spec shape: `plan_id`, `live_pass_active`,
  `is_trial`, `trial_ends_at`, and a `features` object identical to
  `src/lib/features.ts`. Desktop can now gate offline.
- Added `POST /api/v1/device/deactivate` — Bearer-verified; removes a
  `license_devices` row so the device slot is freed.
- Added `POST /api/v1/licence/validate` — returns `valid/revoked` and
  optionally a `refreshed_token` when the DB plan diverges from the JWT claims.
- Switched activation key generator to the spec-mandated A–Z+2–9 alphabet
  (no 0/O/1/I). Normalizer already safe — no DB churn needed for old keys.
- Hardened `/api/v1/dev/mint`: now requires `ALLOW_DEV_MINT=true` env gate in
  addition to `NODE_ENV`, plus an in-memory 10/min/IP rate limit.
- Migration `202604230004_license_plan_fields.sql` adds `plan_id`,
  `live_pass_active`, `is_trial`, `trial_ends_at` to `public.licenses`.
- Companion doc `docs/licence/subscription-model.md` (the spec's missing
  server-side half): plan matrix, API contract, JWT shape, env vars, happy path.
- Tracker `docs/licence/licence-implementation-tracker.md` — phased scope,
  section-by-section spec mapping, rolling done/remaining table.
- `.env.example` fleshed out with every var the server now reads.

## Files Created

- `docs/licence/licence-implementation-tracker.md`
- `docs/licence/subscription-model.md`
- `act_suit/activation-suite/src/lib/features.ts`
- `act_suit/activation-suite/src/app/api/v1/device/deactivate/route.ts`
- `act_suit/activation-suite/src/app/api/v1/licence/validate/route.ts`
- `act_suit/activation-suite/supabase/migrations/202604230004_license_plan_fields.sql`

## Files Modified

- `act_suit/activation-suite/src/lib/token.ts` — fail-hard secret; full claim
  shape; added `verifyActivationToken()`.
- `act_suit/activation-suite/src/lib/activationStore.ts` — plan fields on
  `LicenseRecord`; safe-alphabet `mintActivationKey`; new `findLicenseByDevice`,
  `removeDevice`, `getLicenseById`, `issueTokenForLicense`.
- `act_suit/activation-suite/src/lib/supabaseActivationStore.ts` — `LicenseRow`
  gains plan columns; `claimsFromLicenseRow()`; new `supabaseGetLicenseById`,
  `supabaseDeviceExists`, `supabaseRemoveDevice`, `supabaseIssueTokenForRow`.
- `act_suit/activation-suite/src/lib/licenseService.ts` — plan args pass-through.
- `act_suit/activation-suite/src/app/api/v1/dev/mint/route.ts` — plan args,
  `ALLOW_DEV_MINT` gate, rate limit.
- `act_suit/activation-suite/.env.example` — complete var list with notes.
