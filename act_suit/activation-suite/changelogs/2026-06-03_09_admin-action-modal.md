# Admin action modal (replaces alert/prompt) with current-state context

**Date:** 2026-06-03
**Type:** UI Enhancement

## Summary

Replaced the browser `window.confirm` / `window.prompt` dialogs across the admin
console with a proper in-app modal. Every action modal now shows a **"Current
state"** panel — the thing's previous state and relevant detail — so the
operator understands exactly what they're acting on before confirming.

## Changes

- **New `src/components/admin/AdminModal.tsx`:** reusable modal with a title, a
  "Current state" context panel (label/value rows), an optional body, an
  optional input (number / password / text), validation (number must parse,
  password `minLen`, or `requireMatch` for typed-email confirmation), and
  Cancel / Confirm buttons. Backdrop-click + Enter-to-submit.
- **`src/app/admin/page.tsx`:** removed all `window.confirm`/`prompt`; added
  openers that build a `Subject` (email, status, plan, devices, joined, …) and
  open the modal with tailored context per action:
  - Extend trial / paid expiry → shows current trial/paid expiry + days left
  - Set device seats → shows current limit + in-use count
  - Reset devices → shows active devices
  - Disable / Expire → shows status, plan, devices, current expiry
  - Soft delete / Permanent delete → full current state; hard delete keeps the
    typed-email confirmation (now an in-modal input with match validation)
  - Send reset email / Set password → shows user + status; set-password is an
    in-modal password field (min 8)
- **`src/components/admin/WaitlistSection.tsx`:** Invite / Re-invite / Reject now
  open the modal (showing email, name, status, previous code) instead of a
  `window.confirm`.

## Files Created

- `src/components/admin/AdminModal.tsx`
- `changelogs/2026-06-03_09_admin-action-modal.md`

## Files Modified

- `src/app/admin/page.tsx` — modal openers + render (shared component)
- `src/components/admin/WaitlistSection.tsx` — invite/reject via modal
