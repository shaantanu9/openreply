# Homepage invite-request section + waitlist→converted on redeem

**Date:** 2026-06-03
**Type:** Feature

## Summary

Made the invite flow first-class on the homepage (visitors can request an invite
right there) and closed the funnel loop: when an invited person signs up and
their code is redeemed, their waitlist entry flips to `converted`.

## Changes

- **New `src/components/marketing/RequestInviteSection.tsx`:** a homepage
  waitlist-capture section (`id="request-invite"`) — invite-only-beta framing,
  email + name + "what for" form → `POST /api/v1/waitlist` → "🎟️ You're on the
  list" success state, plus an "Already have a code? Claim it →" link to
  `/sign-in`.
- **`src/app/page.tsx`:** renders `<RequestInviteSection />` in the CLOSE block
  (after FinalPromise, before the final CTA).
- **CTAs → homepage form:** `FeaturesGrid` "Request your invite →" and
  `UseCasesSection` "Unlock your market's gaps →" now anchor to
  `/#request-invite` (scroll to the form) instead of `/sign-in`.
- **`src/lib/couponService.ts`:** after a successful redemption, mark the
  matching waitlist row(s) `converted` (by `invite_code` and by `email`),
  non-fatal — so the admin Waitlist funnel reads pending → invited → converted.

## Files Created

- `src/components/marketing/RequestInviteSection.tsx`
- `changelogs/2026-06-03_11_homepage-invite-request-and-waitlist-convert.md`

## Files Modified

- `src/app/page.tsx`
- `src/components/marketing/FeaturesGrid.tsx`, `src/components/marketing/UseCasesSection.tsx`
- `src/lib/couponService.ts`
