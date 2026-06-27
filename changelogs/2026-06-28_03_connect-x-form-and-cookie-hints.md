# Settings → Connect X form + persistent cookie hints

**Date:** 2026-06-28
**Type:** UI Enhancement

## Summary

Two UX follow-ups so connecting accounts is self-explanatory:
1. A **Settings → "Publish to X / Twitter"** card to paste the four OAuth keys in
   the UI (instead of the `gapmap publish set-creds` CLI), with a developer-portal
   link and a live connected/not-connected badge.
2. A **persistent hint on each not-connected cookie Connections card** naming the
   exact cookies needed (e.g. `auth_token`, `ct0`) and how to get them — so users
   see the requirement before clicking, complementing the live "why import
   failed" reason shown after an Import attempt.

## Changes (`or/dynamic.js`)

- `buildPublishCard(el)` + `st-publish` Settings card: four inputs (api key /
  secret / access token / secret) → `api.publishSetXCreds`; status via
  `api.publishStatus`; toggles label between "Connect X" / "Update keys".
- `connCard` now renders a `cookieHint` row for not-connected cookie sources:
  "Needs `auth_token`, `ct0` — log in & Import, or Paste via Cookie-Editor →
  Export" (driven by the `need` field added to `list_connections`).

## Verification

- `vite build` clean; `node --check` passes.
- Backend round-trip confirmed: `publish status` false → `set-creds` → `status`
  true (the form's path).

## Files Modified

- `app-tauri/src/or/dynamic.js`
