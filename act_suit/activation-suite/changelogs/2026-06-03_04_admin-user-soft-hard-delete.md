# Admin: soft delete + permanent delete for users

**Date:** 2026-06-03
**Type:** Feature

## Summary

Added admin console options to **soft delete** (recoverable) and **permanently
delete** a user. Permanent delete removes the auth user (cascading all community
data) plus every email-keyed activation/billing row, freeing the email so the
same address can sign up + activate again — useful for re-testing.

## Changes

- **Migration `20260603_user_deletion.sql`:**
  - `licenses.deleted_at timestamptz` soft-delete marker (+ index).
  - `admin_soft_delete_user(email)` — revokes licence, sets `deleted_at`, frees
    device seats, bans the auth user from login. Recoverable.
  - `admin_restore_user(email)` — undoes the soft delete (unsets `deleted_at`,
    status→active, unbans auth user).
  - `admin_hard_delete_user(email)` — permanent: `delete from auth.users`
    (cascades profiles → workspaces/byok/posts/insights/sweeps/published_research/
    upvotes/follows/enterprise_actions) plus email-keyed deletes across
    `coupon_redemptions`, `activation_attempts`, `licenses` (→ devices),
    `onboarding_responses`, `app_users` (→ subscriptions/payments/wallets/ledger).
  - All three are `SECURITY DEFINER`, transactional, and `EXECUTE`-granted only
    to `service_role`.
- **`src/lib/supabaseActivationStore.ts`:** `supabaseDeleteUser(email, mode)`
  RPC wrapper; `deletedAt` added to `AdminLicenseRow`, `AdminLicenceDetail`, the
  list query, and the detail query.
- **`src/app/api/v1/admin/user/route.ts`:** new `POST` for `soft_delete` /
  `restore` / `hard_delete`. Owner-only (admin cookie / `x-admin-secret`).
  `hard_delete` requires `confirm` to equal the email.
- **`src/app/admin/page.tsx`:** delete/restore actions in the detail view and
  the row "Manage" dropdown; `SOFT-DELETED` badge + strikethrough on deleted
  rows; permanent delete does a `confirm()` + typed-email prompt before firing.

## Files Created

- `supabase/migrations/20260603_user_deletion.sql`
- `changelogs/2026-06-03_04_admin-user-soft-hard-delete.md`

## Files Modified

- `src/lib/supabaseActivationStore.ts`
- `src/app/api/v1/admin/user/route.ts`
- `src/app/admin/page.tsx`

## Deploy note

The migration must be applied to the Supabase project (PAT / Management API)
**before** the new UI/API are deployed, or the RPC calls will error.
