# Docs: FEATURES.md + Beta/Admin operator guide; full system verification

**Date:** 2026-06-03
**Type:** Documentation

## Summary

Verified the whole system end-to-end against production and documented it.
All core paths confirmed working; added a root `FEATURES.md` (mandatory feature
catalog) and a comprehensive operator guide for the beta/coupon/waitlist/admin
system.

## Verification (production, 2026-06-03)

- Site login: Supabase `generate_link` → `verify type=email` → access token ✓
- App login: master-key `device/activate` → `licence/validate` → `{valid:true}` ✓
- Region: functions on `sin1` (co-located with the Singapore DB) ✓
- Public `coupon/validate`: real code `valid:true`; bogus → `not_found` ✓
- Auth gating: `admin/coupons`, `admin/waitlist`, `admin/user` all `403` without secret ✓
- Controlled loop: waitlist join → admin invite (code generated + emailed) →
  generated single-use code validates → reject ✓; **test data cleaned up** ✓

## Files Created

- `FEATURES.md` — feature catalog (26 features across auth, licensing, beta,
  admin, email, dashboard, marketing/infra) with status + `file` citations +
  known gaps + a reconciling summary table.
- `docs/BETA_AND_ADMIN.md` — operator guide: lifecycle diagram, data model,
  admin console walkthrough, cohort playbook, email, env vars, SQL recipes,
  no-side-effect smoke test, troubleshooting table.
- `changelogs/2026-06-03_07_features-and-beta-admin-docs.md`

## Notes

- No code changes — docs only.
- `FEATURES.md` flags one 🟡: LemonSqueezy billing is present but disabled
  (`BILLING_ENABLED=0`) with blank `NEXT_PUBLIC_LEMONSQUEEZY_*` URLs to set
  before enabling.
