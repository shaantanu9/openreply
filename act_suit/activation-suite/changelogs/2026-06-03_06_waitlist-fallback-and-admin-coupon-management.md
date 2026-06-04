# Beta waitlist fallback + admin coupon/waitlist management

**Date:** 2026-06-03
**Type:** Feature

## Summary

Completed the invite-only beta: code-less visitors can now join a **waitlist**
instead of being hard-blocked, and the admin console gained full **coupon/code
management** plus **waitlist management** (invite with auto-generated single-use
codes + branded email).

## Changes

### Waitlist (public fallback)
- **Migration `20260603_03_waitlist.sql`:** `waitlist` table (email unique, name,
  role, reason, status pending/invited/converted/rejected, invite_code,
  timestamps). RLS on; access only via service-role API routes.
- **`POST /api/v1/waitlist`** (public): idempotent join by email.
- **`SignInPanel`:** "No invite code? Join the waitlist →" reveals a request-access
  form (email + what-for) with a "you're on the list" success state. Shown from
  the invite gate when no valid code is entered.

### Admin: coupon / code management
- **`GET/POST /api/v1/admin/coupons`** (owner-only): list coupons with seats-used
  + redemption counts; create codes (auto or custom code, plan, seats, expiry,
  device seats, note); enable/disable.
- **`CouponsSection`:** create form + table (seats used, full badge, status,
  expiry, note, copy code, disable/enable) + recent-redemptions list.

### Admin: waitlist management
- **`GET/POST /api/v1/admin/waitlist`** (owner-only): list (filter by status);
  invite (generates a single-use coupon, marks row invited, emails the code via
  `sendBetaInviteEmail`); reject.
- **`WaitlistSection`:** status filters + counts, table with Invite / Re-invite /
  Reject actions, shows the generated code inline.

### Shared
- **`src/lib/betaAdminStore.ts`:** coupon + waitlist service functions, incl.
  `generateCouponCode()` (GAPMAP-XXXX-XXXX, ambiguity-free alphabet) and
  `inviteFromWaitlist()`.
- **`src/lib/email.ts`:** branded `sendBetaInviteEmail(to, code, name?)`.
- **`src/app/admin/page.tsx`:** tab bar (Users / Coupons / Waitlist).

## Files Created

- `supabase/migrations/20260603_03_waitlist.sql`
- `src/lib/betaAdminStore.ts`
- `src/app/api/v1/waitlist/route.ts`
- `src/app/api/v1/admin/coupons/route.ts`
- `src/app/api/v1/admin/waitlist/route.ts`
- `src/components/admin/CouponsSection.tsx`
- `src/components/admin/WaitlistSection.tsx`
- `changelogs/2026-06-03_06_waitlist-fallback-and-admin-coupon-management.md`

## Files Modified

- `src/lib/email.ts` — `sendBetaInviteEmail`
- `src/components/auth/SignInPanel.tsx` — waitlist fallback form
- `src/app/admin/page.tsx` — tab bar + section wiring
