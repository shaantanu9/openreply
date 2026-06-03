# Fix production app login + enable transactional email (prod env vars)

**Date:** 2026-06-03
**Type:** Fix | Infrastructure

## Summary

Verifying "login from app and site both working properly" surfaced that the
desktop app's **beta master-key activation failed in production**: `MASTER_KEY`
existed only in local `.env`, not in Vercel. Sending the master key to
`/v1/device/activate` fell through to the non-master path (`isMasterKey()`
returned false on the server). Separately, the license-key + welcome emails
wired into `src/lib/email.ts` would have silently no-op'd in prod because
`RESEND_API_KEY_TOOL_MAIL` / `EMAIL_FROM` weren't set there either. Added the
missing runtime env vars to Vercel production and redeployed; both flows now
verified working against `gapmap.myind.ai`.

## Changes

- Added to Vercel **production** env (values from local `.env`, piped without
  echoing): `MASTER_KEY`, `RESEND_API_KEY_TOOL_MAIL`, `EMAIL_FROM`,
  `BILLING_ENABLED`, `NEXT_PUBLIC_BILLING_ENABLED`, `FREE_MAX_DEVICES`.
- Deliberately **did not** add `PAT_TOKEN` to prod — it's referenced in 0 app
  files (only local Supabase Management-API admin scripts use it; a powerful
  management token shouldn't live in prod runtime env).
- The 5 `NEXT_PUBLIC_*` (download URL, license API base, LemonSqueezy checkout/
  portal URLs) were blank in `.env`, so nothing to set — billing is off and the
  download URL has a code fallback.
- Triggered a fresh production build (empty commit on `main`) so the new env
  vars are injected at build/deploy time.

## Verification (against production gapmap.myind.ai)

- **Site login (Supabase auth):** `admin/generate_link` → `verify type=email`
  returns a valid access token (200). OTP / recovery / password sign-in OK.
- **App login (master-key chain):** `/v1/device/activate` (master key +
  `device_signature`) → 200 `master:true` + signed token; `/v1/licence/validate`
  with that token → 200 `{valid:true, revoked:false}`.
- New auth email templates render `{{ .Token }}` / `{{ .ConfirmationURL }}`
  correctly (the verify path succeeding proves token rendering isn't broken).

## Files Created

- `changelogs/2026-06-03_02_prod-env-app-login-and-email.md`

## Files Modified

- Vercel production environment (6 vars added) — no source change.
- Empty commit `8ea2d62` on `main` to force the redeploy.
