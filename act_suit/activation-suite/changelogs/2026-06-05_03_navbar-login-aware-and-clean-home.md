# Login-aware navbar everywhere + clean app-home for signed-in users

**Date:** 2026-06-05
**Type:** Fix | UI Enhancement

## Summary

The marketing navbar was login-aware, but the **compact** navbar (used on
`/dashboard`, `/workspaces`, `/settings/*`, `/activate`, `/redeem`,
`/activation-help`) hardcoded a "Sign in" link and had no download button — so a
logged-in user on their own dashboard saw "Sign in". Fixed the compact variant
to mirror the marketing variant's auth logic and added a Download CTA to it.
Also decluttered the home page for signed-in users: they now get a compact
"Welcome back" app-launcher and the conversion-only sections (urgency banner,
invite-capture hero, request-invite, get-beta CTA) are hidden. The full
marketing funnel is unchanged for logged-out visitors.

## Changes

- **NavBar compact variant** now reads `useSession()`:
  - signed in → `Home · Dashboard · Workspaces · Activation help` + UserMenu
  - signed out → `Home · Sign in · Activation help`
  - **Download for Mac** button shown in both states (it was missing entirely)
- **Home page**: signed-in users see `<SignedInWelcome>` (Open dashboard ·
  Download · Workspaces · Explore) at the top; `UrgencyBanner`, `InviteHero`,
  `RequestInviteSection`, and `CtaSection` are wrapped in `<SignedOutOnly>`.
- New client gates `<SignedInOnly>` / `<SignedOutOnly>` wait for
  `status === "ready"` before hiding, so the logged-out marketing page paints
  instantly with no flash of signed-in UI.

## Files Created

- `src/components/shell/AuthGate.tsx` — `SignedInOnly` / `SignedOutOnly` gates
- `src/components/marketing/SignedInWelcome.tsx` — logged-in app-launcher

## Files Modified

- `src/components/shell/NavBar.tsx` — compact variant login-aware + Download CTA
- `src/app/page.tsx` — welcome launcher + gate conversion-only sections
