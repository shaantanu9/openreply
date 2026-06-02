# Add /v1/licence/validate alias + return expiry so the desktop app can sync renewals

**Date:** 2026-06-02
**Type:** Feature

## Summary

Part of making licence **renewal auto-pick-up** work end to end (the desktop app
side is in the `reddit-myind` repo). The desktop app calls the `/v1/...` namespace,
but only `/api/v1/licence/validate` existed — so there was no validate endpoint the
app could reach. Worse, the validate response never returned the current `expires_at`,
and its "changed" check only compared plan/trial flags (not the expiry date) — so even
a successful validate gave the app no way to learn a renewed expiry.

This adds the `/v1/licence/validate` alias and enriches the validate response so the
desktop app can sync a renewal (extended `expires_at`) or detect a revocation without
the user re-entering their key.

## Changes

- **New route** `src/app/v1/licence/validate/route.ts` — thin alias that re-exports the
  canonical `POST` from `src/app/api/v1/licence/validate/route.ts` (single source of
  truth, behaviour can't drift). Verified live: returns 401 (missing bearer), not 404.
- **Enriched validate response** in `src/app/api/v1/licence/validate/route.ts`: every
  `{ valid: true }` response (both Supabase and file-store paths) now also returns
  `expires_at`, `trial_ends_at`, `is_trial`, `plan_id`, and `status`. The desktop app
  reads `expires_at` to update its locally-stored expiry, so a renewal unlocks the app
  automatically on the next re-validation.

## Files Created

- `src/app/v1/licence/validate/route.ts` — `/v1` alias of the validate endpoint
- `changelogs/2026-06-02_02_licence-validate-alias-and-expiry-sync.md` — this entry

## Files Modified

- `src/app/api/v1/licence/validate/route.ts` — include `expires_at`/`trial_ends_at`/
  `is_trial`/`plan_id`/`status` in the valid responses (Supabase + file-store paths)
