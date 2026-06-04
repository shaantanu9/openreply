# Homepage beta/FOMO CTAs + admin password management

**Date:** 2026-06-03
**Type:** Feature | UI Enhancement

## Summary

Aligned the public marketing site with the invite-only beta (the CTAs still
promised open "free account" signup), with 5 distinct sales-pitch CTA variants +
an "invite-only beta" scarcity badge. Also added admin password management:
send a reset email and set a user's password directly.

## Changes

### Homepage / sales pages (invite-only + FOMO)
- Added a hero badge: **"🔒 Invite-only beta · limited founding seats"**
  (static — reliable on the ISR-cached marketing page; a live count would be stale).
- 5 sales-pitch CTA variants replacing the generic "Start free account":
  1. Hero — **Claim your founding invite →**
  2. CtaSection — **Get early access — free in beta →**
  3. RoiSection — **Join the founding beta →**
  4. FeaturesGrid — **Request your invite →**
  5. UseCasesSection — **Unlock your market's gaps →**
  - NavBar — **Get beta access**; hero note → "Free during beta · no card · or join the waitlist in 10s".
- Reframed now-misleading "View Pro plans / Compare plans / View plans" (billing
  is off) → "Why it's free in beta →" / "See what's included →" / "Pricing".
- `/pricing` "Free while in beta" copy now says **invite-only**; CTA → "Claim your free beta invite →".
- Files: `HeroSlider`, `CtaSection`, `RoiSection`, `FeaturesGrid`,
  `UseCasesSection`, `shell/NavBar`, `app/pricing/page.tsx`.

### Admin password management
- **Migration `20260603_04_admin_auth_lookup.sql`:** `admin_get_auth_user_id(email)`
  SECURITY DEFINER (service_role only) — resolves an `auth.users` id by email.
- **`src/lib/supabaseActivationStore.ts`:** `supabaseAdminFindAuthUserId`,
  `supabaseAdminSetPassword` (via `auth.admin.updateUserById`, min 8 chars),
  `supabaseAdminSendPasswordReset` (triggers the OTP reset email via
  `/auth/v1/otp` — same code the Forgot-password screen verifies with type:email).
- **`src/app/api/v1/admin/user/route.ts`:** new actions `send_reset` and
  `set_password` (owner-only).
- **`src/app/admin/page.tsx`:** "Send reset email" + "Set password…" in the user
  detail view and the row dropdown.

## Files Created

- `supabase/migrations/20260603_04_admin_auth_lookup.sql`
- `changelogs/2026-06-03_08_homepage-beta-cta-and-admin-password.md`

## Files Modified

- `src/components/marketing/{HeroSlider,CtaSection,RoiSection,FeaturesGrid,UseCasesSection}.tsx`
- `src/components/shell/NavBar.tsx`, `src/app/pricing/page.tsx`
- `src/lib/supabaseActivationStore.ts`, `src/app/api/v1/admin/user/route.ts`, `src/app/admin/page.tsx`
