# Next.js Licence Portal — End-to-end

**Date:** 2026-04-24
**Type:** Feature + Infrastructure

## Summary

Pivoted the licence/activation surface from the Tauri desktop refactor (Phase G
in the prior tracker) into the Next.js `activation-suite`. The desktop gets to
stay thin — the web app now carries the full plan/devices/billing portal UX,
including a Lemon Squeezy webhook that mints and issues keys from real
purchases.

## Changes

- `src/lib/features.ts`, `src/lib/token.ts` already held the JWT contract from
  yesterday — this commit adds everything around them.
- New `src/lib/lemonSqueezyServer.ts` — HMAC-verified webhook helper, variant
  → plan mapper (env-driven via `LS_VARIANT_MAP`), customer-portal URL mint
  via the LS API (falls back to public portal link).
- New licence helpers on `src/lib/supabaseActivationStore.ts`:
  `supabaseLicenceForEmail`, `supabaseRemoveDeviceForEmail`,
  `supabaseCreateTrialForEmail`, `supabaseUpsertLicenceFromWebhook`,
  `supabaseMarkLicenceFromWebhook`.
- New browser client at `src/lib/licenceClient.ts` wrapping the new routes.
- Five new API routes:
  - `GET  /api/v1/licence/me` — authenticated licence + devices + features.
  - `GET/DELETE /api/v1/devices` — user-initiated deactivation.
  - `POST /api/v1/trial/start` — 14-day (configurable via `TRIAL_DAYS`)
    Pro trial, refuses if the user already owns an active licence.
  - `GET  /api/v1/billing/portal` — signed LS portal URL for the caller.
  - `POST /api/v1/webhooks/lemonsqueezy` — HMAC-verified, dispatches
    `order_created`/`subscription_*` events.
- New `/dashboard` route + `DashboardPanel` component — plan summary, trial
  banner, live device list with deactivate action, billing portal button, and
  a features-unlocked panel driven by the same `featuresFor()` resolver the
  JWT uses.
- `ActivatePanel` rewired: mocked devices/plan replaced with live
  `/api/v1/licence/me` data; "Start 14-day trial" button; real
  deactivate-device action; deep-linking still intact.
- `UserMenu` surfaces Dashboard + Activate-new-device links.
- `ROUTES.dashboard` added to `src/lib/constants.ts`.
- `html_site/activate.html` and `html_site/activation-help.html` are now thin
  meta-redirects to the Next.js app (read `GAPMAP_APP_BASE` from
  `env.config.js`; fall back to same-origin).

## Files Created

- `act_suit/activation-suite/src/lib/lemonSqueezyServer.ts`
- `act_suit/activation-suite/src/lib/licenceClient.ts`
- `act_suit/activation-suite/src/app/api/v1/licence/me/route.ts`
- `act_suit/activation-suite/src/app/api/v1/devices/route.ts`
- `act_suit/activation-suite/src/app/api/v1/trial/start/route.ts`
- `act_suit/activation-suite/src/app/api/v1/billing/portal/route.ts`
- `act_suit/activation-suite/src/app/api/v1/webhooks/lemonsqueezy/route.ts`
- `act_suit/activation-suite/src/app/dashboard/page.tsx`
- `act_suit/activation-suite/src/components/dashboard/DashboardPanel.tsx`

## Files Modified

- `act_suit/activation-suite/src/lib/supabaseActivationStore.ts` — dashboard
  helpers + webhook upsert/mark helpers.
- `act_suit/activation-suite/src/components/activate/ActivatePanel.tsx` — real
  data wiring, trial CTA, deactivate-per-device.
- `act_suit/activation-suite/src/components/shell/UserMenu.tsx` — dashboard
  entry.
- `act_suit/activation-suite/src/lib/constants.ts` — `ROUTES.dashboard`.
- `act_suit/html_site/activate.html` — meta-redirect to Next.js `/activate`.
- `act_suit/html_site/activation-help.html` — meta-redirect to Next.js
  `/activation-help`.
