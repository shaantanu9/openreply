# Health endpoints return version-gate fields

**Date:** 2026-06-04
**Type:** Feature

## Summary

`/v1/health` and its `/api/v1/health` mirror now return env-driven version-gate
fields so the desktop app's boot/periodic force-update check works on either
path. Making a release mandatory is a Vercel env-var flip — no code redeploy.

## Changes

- `src/app/v1/health/route.ts` + `src/app/api/v1/health/route.ts`: return
  `min_app_version` (`MIN_APP_VERSION`), `latest_app_version`
  (`LATEST_APP_VERSION`), and `app_download_url` (`APP_DOWNLOAD_URL` /
  `NEXT_PUBLIC_APP_DOWNLOAD_URL`, default `https://gapmap.myind.ai/download`).

## Files Modified

- `src/app/v1/health/route.ts`, `src/app/api/v1/health/route.ts`

## Files Created

- `changelogs/2026-06-04_05_health-version-gate.md`
