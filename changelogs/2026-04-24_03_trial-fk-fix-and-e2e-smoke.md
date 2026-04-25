# Trial FK Fix + End-to-End Smoke Script

**Date:** 2026-04-24
**Type:** Fix + Infrastructure

## Summary

End-to-end curl test against the live Supabase project surfaced a single
real bug: `POST /api/v1/trial/start` was passing the Supabase auth user id
into `licenses.app_user_id`, but that column FKs into `public.app_users`
(the registration-side table), not `auth.users`. Fixed by leaving the
column null for Community trial starts. Also landed a reusable smoke
script so this flow can be re-run at any time.

## Changes

- `src/app/api/v1/trial/start/route.ts` — drop `appUserId` from the trial
  create call. `app_user_id` stays null for Community-driven trials.
- `scripts/e2e-smoke.sh` — full E2E flow: creates a confirmed test user
  via the admin API, signs in, runs through health / licence /
  workspaces / sources / sweep / insights / publish / explore / byok /
  validate / unpublish / delete, then deletes the test user on exit.

## Verified flows (against live Supabase)

- `GET /api/v1/health` → 200 `{ok:true}`.
- Unauthenticated calls to every licence + Community route → 401 with a
  clean JSON error.
- Bogus bearer token → 401 with Supabase's JWT-parse error surfaced.
- Validation paths: `/webhooks/lemonsqueezy` without signature → 401;
  `/device/activate` missing fields → 400; `/dev/mint` without
  `ALLOW_DEV_MINT=true` → 403.
- Full happy path with a real Supabase auth user:
  1. `licence/me` on fresh user → free features, licence=null.
  2. `trial/start` → new `pro_trial` licence with safe-alphabet key.
  3. `licence/me` → plan=pro_trial, trial_days_left=13, export_pdf=true.
  4. Workspace create + list + sources add (reddit/hackernews/g2).
  5. `POST /api/v1/sweep` → status=complete, 18 posts, 7 insights.
  6. `insights` top 5 returned with frequency_pct, ranked.
  7. `publish` → ISR page `/explore/<slug>` renders with `h1` title.
  8. `/u/<username>` renders the generated profile page.
  9. `byok` PUT / GET / DELETE round-trip (fake key, smoke_test=false).
  10. `licence/validate` with random fp → `{valid:false, revoked:true}`
      (device mismatch signal, as designed).
  11. `unpublish` + `DELETE /workspaces/<id>` clean up.
  12. Test user deleted via admin API.

## Files Created

- `act_suit/activation-suite/scripts/e2e-smoke.sh`

## Files Modified

- `act_suit/activation-suite/src/app/api/v1/trial/start/route.ts`
