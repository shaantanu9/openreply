# Queue screen + Pricing flow — completed

**Date:** 2026-06-27
**Type:** Feature

## Summary

Finished the two screens flagged in the journey audit. The Queue is now a real
manual-publishing workflow (filter → copy → schedule → mark posted), and Pricing is a
real plan-management flow (see current plan → buy on web → refresh licence / apply key).

## Changes

- **Queue (`renderQueue`) — complete:**
  - **Status filter tabs** with live counts — All / Drafts / Scheduled / Posted.
  - **Copy** button → clipboard (manual posting: copy, post, then mark posted).
  - **Schedule** → `datetime-local` picker → `status=scheduled` + `scheduled_at`;
    **Unschedule** → back to draft and clears the time.
  - Existing Edit (inline body), **Mark posted / Back to draft**, **Delete** retained.
  - Robust loading / error(+retry) / empty / per-tab-empty states.
- **Pricing (`renderPricing`) — complete flow:**
  - **Current-plan summary** card (plan id, trial, expiry) for activated users.
  - **Comparison table** ("How we compare" vs ReplyDaddy / ReplyGuy) restored from the
    static prototype and rendered live.
  - **Real billing actions:** hosted "Upgrade ↗" opens the web billing page via `openUrl`
    (purchase happens there — no fake in-app checkout); **↻ Refresh licence**
    (`licenseRevalidate`) picks up an account-tied upgrade and re-renders; **Apply
    activation key** routes to the activation screen to apply a higher-tier key;
    **Manage in Settings** link. Current tier shows a disabled "✓ Current plan" button.

## Verification

- `vite build` passes (242 KB).
- Schedule path uses the existing `content_update(scheduled_at, status)` (CLI/Rust/JS)
  verified earlier; `licenseRevalidate` / `openUrl` are pre-existing wired commands.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `renderQueue` (tabs/copy/schedule/unschedule) and
  `renderPricing` (current plan + comparison table + refresh/apply-key/upgrade actions).

## Follow-up

- Hosted-tier purchase requires the web billing page to exist at `<api_base>/pricing`;
  the in-app side (open → refresh → apply key) is complete.
