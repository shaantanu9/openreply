# Docs: FEATURES.md + operator guide updated for device + invite flow

**Date:** 2026-06-04
**Type:** Documentation

## Summary

Brought `FEATURES.md` and `docs/BETA_AND_ADMIN.md` in lockstep with everything
shipped since: the device binding/heartbeat model, the homepage invite hero,
hybrid auto-invite, waitlist→converted funnel, anti-abuse caps, the admin action
modal, and the simplified signup.

## Changes

- **`FEATURES.md`:** rebuilt summary table (now 32 features: 31 ✅, 1 🟡).
  - Renamed "Licensing & activation" → "Licensing & device binding" and added
    **Device binding & seat enforcement** and **Device heartbeat & active-now**.
  - Beta invite grew to 8: added **Homepage invite hero**, **Hybrid auto-invite
    endpoint**, **Waitlist → converted funnel**, **Anti-abuse: send cap +
    throttle**.
  - Updated Account creation (full name + confirm password), Users tab (modal +
    password actions + live status), Dashboard device management (active-now),
    Marketing (invite hero). Added 2026-06-03 verification notes.
- **`docs/BETA_AND_ADMIN.md`:** new lifecycle diagram (homepage hero →
  auto-invite/waitlist → convert → device activation); data-model functions +
  `waitlist.invite_sends` / `license_devices.last_seen_at`; new **§6b Devices,
  sessions & "is the key in use?"** and **§6c Anti-abuse / rate limits**;
  `BETA_AUTO_INVITE_SEATS` env; Users password actions; updated verification log
  + changelog pointers.

## Files Created

- `changelogs/2026-06-04_01_docs-device-invite-flow.md`

## Files Modified

- `FEATURES.md`, `docs/BETA_AND_ADMIN.md`
