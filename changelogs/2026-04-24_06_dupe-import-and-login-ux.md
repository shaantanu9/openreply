# Duplicate Import Kill + Login UX Hardening

**Date:** 2026-04-24
**Type:** Fix

## Summary

Two user-reported bugs: the Tauri app was blank with
`SyntaxError: Cannot declare an imported binding name twice: 'openDialog'`,
and Next.js login "wasn't working" against a Supabase project that was
otherwise healthy.

## Fix 1 — Tauri duplicate import

`app-tauri/src/screens/settings.js` had two identical lines at 6–7:

```js
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
```

ESM forbids redeclaring a binding. Module-level parse fails →
`settings.js` never evaluates → `main.js` (which imports
`renderSettings`) never evaluates → entire webview stays blank. The
splash safety net we added earlier was dismissing the splash correctly
but the main window was blank for a real reason.

Removed the duplicate. Vite HMR picked up the change and the app
restarted clean.

## Fix 2 — Login UX hardening

Supabase Auth itself was verified working (curl → password grant →
access_token). But `SignInPanel.tsx` had three small frictions that
combined to make login feel broken:

1. `loginPwd` wasn't trimmed, so Safari autofill trailing whitespace
   caused silent `invalid_credentials` rejections.
2. 900 ms delay between success banner and redirect felt like nothing
   was happening.
3. Errors surfaced only via `parseError()` which stripped context;
   no console breadcrumb to inspect in devtools.
4. Router used `push` so a back-button from `/activate` returned to
   the stale sign-in page.

Patched all four: trim both fields, redirect with `replace`, cut delay
to 250 ms, and log the full `error` object to `console.error` so
debugging is trivial from devtools.

Also added a guard: if Supabase returns `{ data: { session: null } }`
(which happens when email-confirm is enabled and the user hasn't
verified), the panel surfaces a specific message instead of optimistically
claiming success.

## Files Modified

- `app-tauri/src/screens/settings.js`
- `act_suit/activation-suite/src/components/auth/SignInPanel.tsx`

## Verified

- Tauri: pid 36086 now uptime ~10 min, `/src/screens/settings.js` served
  by vite has exactly one `openDialog` import.
- Next.js: `tsc --noEmit` clean. Direct Supabase password-grant with
  `desktop-test+1776995604@openreply-dev.local / DesktopTest_1776995604_pw`
  returns a JWT — the credentials I handed you earlier *do* work.
