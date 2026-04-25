# `/api/v1/device/activate` — Drop Password Requirement

**Date:** 2026-04-24
**Type:** Fix + UX

## Summary

Desktop activation was returning "Login failed. Check email/password and try
again" for every trial licence. Root cause: the legacy
`/api/v1/device/activate` endpoint matched licences by
`(email, password_hash, activation_key_hash)`, but trial licences created
via `/api/v1/trial/start` store a **random unguessable `password_hash`**
(by design — trial users authenticate via Supabase session, not a
password). No password the user could type would ever match, so the
desktop legacy flow was unreachable for trial licences.

## Fix

Both `activateDeviceSupabase` (Supabase-backed store) and `activateDevice`
(file-backed dev store) now look up licences by
`(email, activation_key_hash)` only. The `password` field is still
accepted in the request body for backward compat but is no longer
verified.

Security rationale: the 16-char `A-Z` + `2-9` activation key carries ~80
bits of entropy, stored as `sha256(key)`. Possession of the key is the
authentication — exactly how Paddle / Lemon Squeezy / Gumroad all
handle licence keys. Email is a scope hint, not a secret. Removing the
password check closes the trial-activation gap without weakening
actual security.

## Verified

End-to-end test against the live server (Next.js on :3007, Supabase on
tjikcnsfaaqihgegecpi):

```bash
curl -X POST http://127.0.0.1:3007/api/v1/device/activate -d '{
  "email": "desktop-test+1776995604@gapmap-dev.local",
  "password": "whatever-anything-is-accepted-now",
  "activation_key": "BWCS-JSSC-M8CL-6BA8",
  "device_signature": "<sha256>",
  "app": "gapmap-desktop", "os": "macos", "arch": "aarch64"
}'
→ ✅ activation succeeded
  license_id: fe3db956-cae3-4362-9703-02e3b82afb0a
  token issued, 963 char JWT
  devices_used: 1 / 1
```

## Follow-up

The Tauri welcome Step 6 still renders a `PASSWORD` input because the
form pre-dates this change. The field is harmless (server accepts any
value) but the copy should be relaxed — optional now. That's a cosmetic
cleanup for a future pass.

## Files Modified

- `act_suit/activation-suite/src/lib/supabaseActivationStore.ts` —
  drop `.eq("password_hash", passwordHash)` from the licence lookup.
- `act_suit/activation-suite/src/lib/activationStore.ts` — mirror fix
  for the file-backed dev store.
