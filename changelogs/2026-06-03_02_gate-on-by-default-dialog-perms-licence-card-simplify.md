# Licence gate ON by default + fix signout dialog + simplify the licence card

**Date:** 2026-06-03
**Type:** Feature / Fix

## Summary

Three related changes that make the desktop app enforce licensing and fix the
activation UX:

1. **Gate ON by default** — the app now requires an activated licence. With no
   valid key the whole UI is gated to the activation screen and MCP commands are
   refused. It never deletes or touches local data (SQLite topics/posts/insights
   are kept) — it only blocks routes/commands.
2. **Fix the signout crash** — "Sign out of licence" threw
   `dialog.confirm not allowed. Command not found` because the Tauri dialog
   plugin lacked the confirm permission.
3. **Simplify the licence card** — removed the "Licence API base" input; the
   server is resolved automatically and shown read-only. Users now only enter
   email + activation key.

## Changes

- `src-tauri/src/commands.rs` — `license_gate_enabled()` now **defaults to ON**.
  It is OFF only when `GAPMAP_LICENSE_GATE_ENABLED` is explicitly `0/false/no/off`
  (for local dev); unset (shipped DMG) → ON. The frontend follows automatically
  via `license_gate_status()` → `resolveLicenseGate()` → `mustStayInOnboarding()`,
  which redirects every route to `/welcome` until activation.
- `src-tauri/capabilities/default.json` — added `dialog:allow-confirm`,
  `dialog:allow-ask`, `dialog:allow-message` (only `dialog:allow-open` was
  granted), so `window.confirm()` / `alert()` work instead of throwing.
- `src/components/LicenceCard.js`:
  - Removed the `#lic2-base` (API base) input; activation/test now use the
    resolved base (prod constant or dev env). Added a read-only
    "Activation server: … (set automatically)" line.
  - Signout now `await`s the (async) Tauri dialog confirm; copy updated to
    "the app will lock until you re-activate — your local data is kept."

## Verification

- `cargo check` (src-tauri): 0 errors
- App rebuilt via `tauri dev` in 16s, secret-bake warnings 0, dialog plugin
  compiled with the new permissions, app launched
- `node --check` LicenceCard.js OK; no stale `#lic2-base` references remain
- capabilities/default.json validates as JSON

## Files Modified

- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/capabilities/default.json`
- `app-tauri/src/components/LicenceCard.js`

## Files Created

- `changelogs/2026-06-03_02_gate-on-by-default-dialog-perms-licence-card-simplify.md`

## Known follow-up

~10 other `if (!confirm(...))` call sites (byok, personas, collect, home,
welcome, interviews, topic) use the dialog synchronously and don't truly await
the async Tauri dialog — swept in a follow-up commit.
