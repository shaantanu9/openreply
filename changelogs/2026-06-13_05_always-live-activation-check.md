# Always-live activation key check

**Date:** 2026-06-13
**Type:** Fix

## Summary

The licence/activation gate now validates against the **live** server URL on
every check, not just on the 6-hour background timer. `license_status` (the
launch gate the UI reads, and which the boot hard-gate `await`s) now runs a
live `license_revalidate` (`POST {api_base}/v1/licence/validate`,
default `https://openreply.myind.ai`) **first**, then reads the freshly-synced
state. A renewal unlocks immediately, a server-side revocation/refund/expiry
locks on that very check.

Offline grace is preserved: when the server is unreachable (offline / outage /
blip), `license_revalidate` leaves the cached last-known-good state untouched,
so a legitimate paid user is never locked out on a plane or during a server
hiccup. Never-activated / no-token machines early-return inside `revalidate`
before any network call, so first-run latency is unchanged.

## Changes

- `license_status` calls `license_revalidate(app).await` (best-effort) before
  `compute_activation_reason`, making every activation check live-driven with
  automatic offline fallback.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — `license_status` now performs a live
  revalidate before reading cached licence state.
