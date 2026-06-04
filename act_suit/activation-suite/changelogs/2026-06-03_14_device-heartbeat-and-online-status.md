# Device heartbeat on validate + live "active now" visibility

**Date:** 2026-06-03
**Type:** Feature

## Summary

Completed the device-session model so you can see whether a license key is
actually being used right now, on which device. The desktop app's periodic
`validate` now records a heartbeat, and that "active now / last active" status
surfaces in the admin console and the user dashboard.

## Changes

- **`src/lib/supabaseActivationStore.ts`:** `supabaseTouchDevice(licenseId,
  fingerprint)` — bumps `license_devices.last_seen_at` (best-effort).
- **`/v1/licence/validate`:** calls the heartbeat after confirming the device is
  still attached, so `last_seen_at` reflects real usage (every validate), not
  just the last activation.
- **Admin (`src/app/admin/page.tsx`):** a device is "active" if seen within
  15 min — user list shows **🟢 active** in the Last-seen column; user detail
  header shows **🟢 N active now**; the devices table prefixes active devices
  with 🟢.
- **Dashboard (`src/components/dashboard/DashboardPanel.tsx`):** each activated
  device shows a **🟢 Active now** badge when seen recently.

## Existing behaviour confirmed (no change needed)

- Invite codes are single-use (`max_redemptions=1`, atomic `redeem_coupon`).
- Tokens are device-fingerprint-bound; `validate` rejects on `device_mismatch`
  or if the device was removed (revoked).
- Re-activating the same device re-issues without consuming a seat; a new device
  consumes a seat up to `max_devices`, beyond which → `409 device limit reached`.
- Admin "Reset devices" / dashboard "Deactivate" free seats and invalidate that
  device's token on its next validate.

## Files Created

- `changelogs/2026-06-03_14_device-heartbeat-and-online-status.md`

## Files Modified

- `src/lib/supabaseActivationStore.ts`, `src/app/api/v1/licence/validate/route.ts`
- `src/app/admin/page.tsx`, `src/components/dashboard/DashboardPanel.tsx`
