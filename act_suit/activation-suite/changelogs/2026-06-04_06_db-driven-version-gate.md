# DB-driven app version gate (app_config) + appConfig lib

**Date:** 2026-06-04
**Type:** Feature

## Summary

Adds a DB-driven version gate so the operator can force (or lift) a desktop
update by editing one row — no redeploy. Reads fall back to env vars when the
table is absent/unreachable, so /health never breaks.

## Changes

- **`supabase/migrations/20260604_01_app_config_version_gate.sql`** (NOT YET
  APPLIED to prod — needs explicit run): singleton `app_config` table
  (force_update, min/latest_app_version, download_url), seeded row (force off,
  latest 0.1.19), RLS service-role-only, updated_at trigger. Additive +
  idempotent.
- **`src/lib/appConfig.ts`:** `getVersionGate()` reads `app_config` (service
  role) with env fallback; swallows errors (missing table → env). Only surfaces
  `min_app_version` when `force_update` is on.

## Apply step (manual, pending authorization)

Run the migration via the Management API / SQL editor before relying on the
DB-driven toggle. Until then, the gate is env-driven (graceful fallback).

## Files Created

- `supabase/migrations/20260604_01_app_config_version_gate.sql`
- `src/lib/appConfig.ts`
- `changelogs/2026-06-04_06_db-driven-version-gate.md`
