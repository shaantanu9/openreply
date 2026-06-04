# Full-screen invite hero (top of homepage) + hybrid auto-invite

**Date:** 2026-06-03
**Type:** Feature

## Summary

Added a full-screen invitation hero at the very top of the homepage (above the
existing slider, everything else unchanged) — the confirmed "Minimal Center +
Social-Proof" design. Submitting an email runs the proper end-to-end invite
flow: while founding seats remain it instantly emails a single-use code (which
becomes the licence key on signup); once the cap is hit it falls back to the
waitlist for admin approval.

## Changes

- **New `src/components/marketing/InviteHero.tsx`:** full-viewport-height hero
  (`#invite`) — invite-only badge, serif headline, subcopy, centered email +
  "Request invite", reassurance line, then stats (40k/13/10x) + testimonial +
  "+37 founders joined". Sent / waitlisted success states with a "Sign up →" CTA.
- **`src/app/page.tsx`:** renders `<InviteHero />` as the first section inside
  `SiteShell`, above `HeroSlider`. Nothing else changed.
- **New `POST /api/v1/invite/request`** (public, hybrid auto-invite):
  records the email on the waitlist; if founding seats remain it generates a
  single-use coupon (`inviteFromWaitlist`) and emails it (`sendBetaInviteEmail`),
  marking the row `invited`; if the cap is reached it stays `pending` for admin
  approval. Re-requests re-send the existing code (no extra seat). Seat cap is
  `BETA_AUTO_INVITE_SEATS` (default 100; `0` = pure admin-approval).
- **`src/lib/betaAdminStore.ts`:** added `getWaitlistEntry` + `countActiveInvites`
  (seat accounting).
- **`src/components/marketing/RequestInviteSection.tsx`:** repointed to the same
  `/api/v1/invite/request` endpoint so both homepage capture points behave
  identically (sent vs waitlisted states).

## Whole flow

email in hero → auto-invite (code emailed) → sign up with code → key auto-issued
on dashboard → waitlist row flips to `converted`. Cap reached → waitlist →
admin invites from the console.

## Files Created

- `src/components/marketing/InviteHero.tsx`
- `src/app/api/v1/invite/request/route.ts`
- `changelogs/2026-06-03_12_homepage-invite-hero-autosend.md`

## Files Modified

- `src/app/page.tsx`, `src/lib/betaAdminStore.ts`,
  `src/components/marketing/RequestInviteSection.tsx`
