# Invite-only beta: FOMO sign-up gate + founding-member key flow

**Date:** 2026-06-03
**Type:** Feature

## Summary

Made the beta invite-only to create FOMO and make beta users feel special. A
coupon/invite code is now required to create an account ("both signup + key"):
the code is validated (non-consuming) at sign-up and consumed to issue the Pro
key once the account has a session. Sign-up shows scarcity ("N of 100 seats
left") and a celebratory "you're in, founding member" state; the dashboard
auto-issues the key and shows a Founding Beta Member badge.

## Flow

1. **Sign up** — invite code field gates the form. Live validation via
   `validate_coupon` (no consume). Valid → seat-scarcity chip + celebratory copy
   + submit unlocks ("Claim my founding spot"). Code + `beta_founding` saved to
   the auth user's metadata.
2. **Key issuance** — on first dashboard load with a session and no licence, the
   stored `invite_code` is redeemed (`redeem_coupon` → mints the key, increments
   the coupon counter, writes the audit row). Shows "✨ Issuing your
   founding-member key…" then "🎉 Welcome aboard, founding member".
3. **Founding badge** — dashboard header shows ★ Founding beta member.

## Changes

- **Migration `20260603_02_coupon_validate.sql`:** `validate_coupon(code)` —
  read-only check returning `{valid, reason, plan_id, seats_total, seats_left,
  seats_claimed}` (no counter increment); granted to anon/authenticated/
  service_role. Seeds `OPENREPLY-BETA-2026` (pro, 100 seats, 2 devices). Reuses the
  existing `coupons` / `redeem_coupon` infra from migration 202605250008.
- **`src/app/api/v1/coupon/validate/route.ts`:** public POST wrapping the RPC
  (runs before the account exists).
- **`src/components/auth/SignInPanel.tsx`:** invite-code field with debounced
  live validation, scarcity chip, valid/invalid/checking states, submit gated on
  a valid code, and `invite_code` + `beta_founding` written to signUp metadata.
- **`src/components/dashboard/DashboardPanel.tsx`:** auto-redeem effect (issues
  the key from the stored invite code once a session exists; safe if already
  licensed), Founding Beta Member badge, and an "issuing your key" state.

## Files Created

- `supabase/migrations/20260603_02_coupon_validate.sql`
- `src/app/api/v1/coupon/validate/route.ts`
- `changelogs/2026-06-03_05_invite-only-beta-fomo-flow.md`

## Files Modified

- `src/components/auth/SignInPanel.tsx`
- `src/components/dashboard/DashboardPanel.tsx`

## Operating notes

- Create more cohorts by inserting rows into `public.coupons` (set
  `max_redemptions` for scarcity, `expires_at` for time pressure, `note` for
  context). Seeded code: `OPENREPLY-BETA-2026` (100 seats).
- Existing `/redeem` page still works as a manual fallback.
