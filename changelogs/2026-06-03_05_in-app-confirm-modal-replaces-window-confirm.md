# Replace window.confirm() with an in-app confirm modal (fixes licence sign-out ACL error)

**Date:** 2026-06-03
**Type:** Fix

## Summary

Licence **Sign out** (Settings → Licence) did nothing and logged an unhandled
promise rejection: *"ACL: confirm not allowed"*. Root cause: Tauri routes the
global `window.confirm()` to the dialog plugin's `confirm` command, which needs
the `dialog:allow-confirm` capability active in the **built** binary. That ACL
is unreliable across builds (stale `build.rs` cache / capability drift) — a prior
fix (`1de9c0e`) added the capability yet the error persisted. Every `await
confirm(...)` in the app shared this latent failure. Replaced all of them with a
new pure-DOM in-app confirm modal that has **zero** Tauri-permission dependency,
so it behaves identically in dev and packaged DMG builds.

## Changes

- New `src/lib/confirmModal.js` — `confirmModal(message | { title, body,
  confirmLabel, cancelLabel, danger })` → `Promise<boolean>`. Pure DOM, reuses
  the existing `.modal-backdrop` / `.modal` styles, Enter = confirm, Escape /
  backdrop = cancel, restores focus.
- Licence **Sign out** now uses `confirmModal({ … danger:true })` instead of
  `window.confirm()` (the reported bug).
- Migrated **every** remaining `await confirm(...)` callsite to `confirmModal`
  (same root cause, prevents recurrence on delete/disconnect/reset actions):
  `main.js` (no-LLM warning, existing-topic prompt — given explicit button
  labels), `settings.js` (8: MCP disconnect, clear profile, reset prefs, reset
  UI state, purge trash, uninstall, reset prompt, delete whisper model),
  `byok.js` (3), `topic.js` (2), `home.js`, `collect.js`, `personas.js`,
  `ost.js`, `interviews.js`, `pmf.js`, `estimate.js`.

## Verification

- `grep` confirms zero bare `confirm()` calls remain; every `confirmModal` user
  imports it.
- `npm test` → 50/50 pass · `node --check` clean on all touched files ·
  `npm run build` (Vite) OK.

## Files Created

- `app-tauri/src/lib/confirmModal.js`

## Files Modified

- `app-tauri/src/components/LicenceCard.js`
- `app-tauri/src/main.js`
- `app-tauri/src/screens/settings.js`, `byok.js`, `topic.js`, `home.js`,
  `collect.js`, `personas.js`, `ost.js`, `interviews.js`, `pmf.js`, `estimate.js`
