# Invite anti-abuse: 2-email cap, rate limiting, throttle + "already requested" memory

**Date:** 2026-06-03
**Type:** Fix | Security

## Summary

Hardened the public invite flow against abuse and added returning-visitor memory.

## Changes

### Per-recipient send cap (anti-spam)
- **Migration `20260603_05_waitlist_send_cap.sql`:** `waitlist.invite_sends`
  counter + `increment_waitlist_send(email)` RPC (service_role only).
- **`/api/v1/invite/request`:** never emails one address more than **2** times
  (`MAX_SENDS_PER_EMAIL`). Beyond that it returns `alreadyRequested` without
  sending — so re-submitting can't be used to spam invites to a target or self.
- **`src/lib/betaAdminStore.ts`:** `inviteSends` on `WaitlistEntry` +
  `bumpWaitlistSend()`.

### Rate limiting / throttling (server)
- **New `src/lib/rateLimit.ts`:** in-memory sliding-window limiter (`checkRateLimit`,
  `clientIp`).
- Applied per-IP: `/api/v1/invite/request` (8 / 10 min), `/api/v1/waitlist`
  (8 / 10 min), `/api/v1/coupon/validate` (40 / min — it's keystroke-driven).
  Over-limit → `429` with `Retry-After`.

### Client throttle + "already requested" memory (localStorage)
- **`InviteHero` + `RequestInviteSection`:** 2.5s submit throttle (ignores
  rapid double-submits) and graceful `rate_limited` messaging.
- Both write a `openreply_invite_requested` flag to **localStorage** on success and
  read it on mount — a returning visitor sees "You've already requested your
  invite — check your inbox" (with their email + Sign up CTA) instead of the
  form. (The sign-up invite-code field was already debounced 450ms.)

## Files Created

- `supabase/migrations/20260603_05_waitlist_send_cap.sql`
- `src/lib/rateLimit.ts`
- `changelogs/2026-06-03_13_invite-abuse-caps-throttle-localstorage.md`

## Files Modified

- `src/app/api/v1/invite/request/route.ts`, `src/app/api/v1/waitlist/route.ts`,
  `src/app/api/v1/coupon/validate/route.ts`
- `src/lib/betaAdminStore.ts`
- `src/components/marketing/InviteHero.tsx`, `src/components/marketing/RequestInviteSection.tsx`
