# License-key email now shows plan, expiry, and device count

**Date:** 2026-06-04
**Type:** UI Enhancement

## Summary

The license-key email previously only rendered the key and hardcoded
"Activates up to 2 devices." It now renders a branded facts block with the
real plan, expiry/trial date, device-seat count, and the email the key is tied
to — using the details each issuance route already has. Verified end-to-end by
sending both the key and welcome emails live via Resend (delivered, message IDs
returned).

## Changes

- `sendLicenseKeyEmail(to, key, details?)` gained an optional `LicenceDetails`
  argument (`planId`, `isTrial`, `expiresAt`, `maxDevices`). Backward-compatible
  — callers without details still work.
- Added a "facts" table to the email: **Plan**, **Trial ends / Renews on**
  (or "No expiry · yours for the beta" when `expiresAt` is null), **Devices**
  (Up to N), and **Tied to** (the email). Plan label mapping + safe date
  formatting (`fmtDate`) included.
- Subject line is now plan-aware: "Your Gap Map Pro license key".
- Device count, download CTA, and "reissue from dashboard" link are all driven
  by the real `maxDevices` value (no more hardcoded "2").
- `/api/v1/coupon/redeem` passes `{ planId, isTrial, expiresAt }` from the
  redeem result.
- `/api/v1/licence/free` passes `{ planId: FREE_PLAN_ID, maxDevices }` from the
  created record.

## Files Modified

- `src/lib/email.ts` — `LicenceDetails` type, `planLabel` + `fmtDate` helpers,
  enriched `sendLicenseKeyEmail` HTML + text + subject.
- `src/app/api/v1/coupon/redeem/route.ts` — pass licence details to the email.
- `src/app/api/v1/licence/free/route.ts` — pass plan + device count to the email.
