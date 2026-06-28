# DB ↔ Webapp Sync Audit

**Date:** 2026-04-24
**Type:** Fix + Infrastructure + Documentation

## Summary

User asked whether everything wires together cleanly. Ran a full schema vs
code audit, patched three real drifts, re-ran the E2E smoke, and captured
the final state.

## What was out of sync

1. **`licenses.lemonsqueezy_customer_id`, `lemonsqueezy_order_id`,
   `lemonsqueezy_subscription_id`** — referenced by
   `src/app/api/v1/billing/portal/route.ts` (select) and by
   `supabaseUpsertLicenceFromWebhook` (opportunistic update), but the
   columns did not exist in any migration. `.select()` silently returned
   null; the webhook's `.update()` was swallowed in a try/catch but would
   have 400'd on every delivery.

2. **Trial `password_hash`** was `sha256("")` — a known-constant value.
   A client of the legacy `activateDeviceSupabase` flow who knew the email
   could have authenticated with an empty password. Swapped for a random
   256-bit value (`crypto.randomBytes(32).hex`) — unusable by anyone but
   still satisfies the `not null` constraint.

3. **Published-snapshot source-types** was derived by parsing the first
   three insight URLs, so every snapshot reported only a single source
   (the alphabetically-first one). Now queries `DISTINCT source_type FROM
   posts WHERE workspace_id = ?` which accurately reflects what was swept.

## What was already fine

- Both prior migrations (`202604230004_license_plan_fields.sql`,
  `202604240005_community_schema.sql`) are applied to the remote Supabase
  — probed every table via `/rest/v1/<table>?select=*&limit=0` and got
  200 on all 9.
- Service role bypasses RLS, so server routes write cleanly. Browser
  client uses the Supabase session and gets the RLS policies from
  migration `202604240005`.
- `auth.users → public.profiles` auto-insert trigger works (verified
  via admin API: `test_1776978322` profile was created on signup).
- `licences.app_user_id` FK decoupled from Supabase Auth (trial-start,
  webhook both use null).
- `posts.unique(workspace_id, source_type, source_id)` means re-sweeps
  are idempotent on the sweep id prefix.

## E2E verification after fixes

Ran `scripts/e2e-smoke.sh` against the live Supabase — all 16 steps
passed, including the previously-broken ones:

- Step 2 (`trial/start`) → `{ok:true, activation_key:"ULC2-BEQG-LT6C-DVAJ", trial_ends_at:..., trial_days:14}`
- Step 5 (`licence/me` trial) → `plan=pro_trial, trial_days_left=13, export_pdf=true, max_workspaces=null`
- Step 8 (sweep) → `status=complete posts=18 insights=7 pct=100%`
- Step 10 (`insights` top 5) → ranked by frequency_pct correctly
- Step 11 (`publish`) → `source_types=["g2","reddit","hackernews"]` ✓ (was `["reddit"]` before)
- Step 12 (`GET /explore/<slug>`) → HTTP 200, renders the workspace title
- Step 13 (BYOK PUT/GET/DELETE) → encrypted envelope round-trip
- Step 14 (`licence/validate` with Supabase JWT) → 401 (correct — only
  Pro-licence JWTs accepted)
- Step 15/16 (unpublish + workspace delete) → clean cleanup.

## Files Created

- `act_suit/activation-suite/supabase/migrations/202604240006_lemonsqueezy_ref_columns.sql`

## Files Modified

- `act_suit/activation-suite/src/lib/supabaseActivationStore.ts` — random
  `password_hash` for trial creates; writes `lemonsqueezy_*` columns
  inline instead of via a second update.
- `act_suit/activation-suite/src/lib/community/publish.ts` — source-types
  derived from `posts.source_type`.
- `act_suit/activation-suite/scripts/e2e-smoke.sh` — python f-string
  escapes swapped for `%`-format; `/licence/validate` step accepts the
  expected 401 without aborting.

## Apply the new migration to production

Three new nullable columns on `licenses` + three indexes. Safe, additive,
reversible (`alter table ... drop column` if ever needed). Apply any one
of the following ways:

```bash
# (a) Paste the file into the Supabase SQL Editor (Dashboard → SQL)
cat act_suit/activation-suite/supabase/migrations/202604240006_lemonsqueezy_ref_columns.sql

# (b) Via the Supabase CLI, if you've linked this project locally:
supabase link --project-ref tjikcnsfaaqihgegecpi
supabase db push

# (c) Directly via psql using your DB password from the Supabase dashboard:
psql "postgresql://postgres:<DB_PASSWORD>@db.tjikcnsfaaqihgegecpi.supabase.co:5432/postgres" \
  -f act_suit/activation-suite/supabase/migrations/202604240006_lemonsqueezy_ref_columns.sql
```

None of these are run automatically — applying the migration is a
production-scope action, so I've left it explicit.
