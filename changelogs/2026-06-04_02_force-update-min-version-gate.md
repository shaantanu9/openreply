# Force-update: server-driven min-version gate

**Date:** 2026-06-04
**Type:** Feature

## Summary

The desktop app had no update mechanism. This adds a server-controlled
force-update gate: a release can be made mandatory by flipping a Vercel env var
(no app redeploy). Outdated installs are hard-blocked with a Download screen;
a newer-but-optional release shows a dismissible banner. Fails safe — an
offline/unreachable server never blocks a working build.

## How it works

1. **Server** (`/v1/health` + `/api/v1/health`) now return env-driven fields:
   - `MIN_APP_VERSION` — installs below this are force-updated (hard gate)
   - `LATEST_APP_VERSION` — newest available (soft "update available" nudge)
   - `APP_DOWNLOAD_URL` — where the update screen sends the user
   (defaults to NEXT_PUBLIC_APP_DOWNLOAD_URL → https://openreply.myind.ai/download)
2. **Desktop** `check_app_version(api_base)` (Rust) GETs `/v1/health`, compares
   the built `CARGO_PKG_VERSION` to min/latest via a dotted `version_lt`
   helper, and returns `{update_required, update_available, download_url, …}`.
   Any network/parse failure → `ok:false`, never `update_required`.
3. **Frontend** `lib/updateGate.js` (wired at boot + a 6h re-check):
   - `update_required` → blocking "Update required" overlay (dims the app,
     Download ↗ button, "I've updated — re-check").
   - `update_available` → dismissible soft banner (remembers the dismissed
     version).

## Activation
Dormant until the server is deployed with the new health fields AND
`MIN_APP_VERSION` is set in Vercel. Until then `check_app_version` sees no min
version → no gating. To force a release: set `MIN_APP_VERSION` (and optionally
`LATEST_APP_VERSION`) on openreply-web → outdated apps gate on next boot / within 6h.

## Verification
- `tsc --noEmit` clean · `npm test` 50/50 · `npm run build` OK · `cargo check` 0 errors.

## Files Created
- `app-tauri/src/lib/updateGate.js`

## Files Modified
- `act_suit/activation-suite/src/app/v1/health/route.ts`, `…/api/v1/health/route.ts`
- `app-tauri/src-tauri/src/commands.rs` (check_app_version + version_lt)
- `app-tauri/src-tauri/src/main.rs` (register command)
- `app-tauri/src/api.js` (checkAppVersion), `src/main.js` (wireUpdateGate on boot), `src/style.css`
