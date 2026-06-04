# DB-driven app version gate (force-update toggle from Supabase)

**Date:** 2026-06-04
**Type:** Feature

## Summary

The desktop force-update gate is now driven from a single Supabase row instead
of env vars alone. The operator flips `app_config.force_update` (and sets
`min_app_version`) in the DB to force everyone on an older build to update — no
redeploy. `/health` and `/api/v1/health` read that row (service-role) and fall
back to env vars when the table is missing/unreachable, so the health check
never breaks.

## Semantics

- `force_update = false` → no hard gate; `min_app_version` reported as `null`.
- `force_update = true`  → installs below `min_app_version` are force-updated.
- `latest_app_version`   → soft "update available" pointer (non-blocking); seeded `0.1.19`.
- `download_url`         → where the update screen sends the user.

## Changes

- New table `public.app_config` (singleton row id=1) with `force_update`,
  `min_app_version`, `latest_app_version`, `download_url`, `notes`,
  `updated_at` (+ touch trigger). RLS enabled with no policies — only the
  service role (which bypasses RLS) reads/writes; the desktop only ever talks
  to `/health`.
- New `src/lib/appConfig.ts` → `getVersionGate()`: reads the row, applies env
  fallback, and only surfaces `min_app_version` when `force_update` is on.
- Both health routes now return `{ ok, force_update, min_app_version,
  latest_app_version, app_download_url }` from `getVersionGate()`.

## Operator usage

```sql
-- Force everyone below 0.1.19 to update:
update public.app_config
set force_update = true, min_app_version = '0.1.19'
where id = 1;

-- Lift the force gate:
update public.app_config set force_update = false where id = 1;
```

## Files Created

- `supabase/migrations/20260604_01_app_config_version_gate.sql`
- `src/lib/appConfig.ts`

## Files Modified

- `src/app/v1/health/route.ts` — read gate from DB via `getVersionGate()`.
- `src/app/api/v1/health/route.ts` — same.
