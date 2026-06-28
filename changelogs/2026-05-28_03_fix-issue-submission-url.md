# Fix issue/help URLs to point at canonical myind-ai/openreply repo

**Date:** 2026-05-28
**Type:** Fix

## Summary

The in-app "Send feedback → bug report on GitHub", sidebar "Help & docs", settings README/auth-docs buttons, and the onboarding Reddit setup-guide link all pointed at the old `github.com/shaantanu98/reddit-myind` repo. That repo is no longer the canonical home — issues filed there don't reach the maintainers and the README is stale. Repointed every source-level reference at `https://github.com/myind-ai/openreply` (issue submission goes to `/issues` per the new tracker).

Also confirmed: first-install onboarding already runs — `main.js` redirects to `#/welcome` until `isOnboardingComplete()` returns true, and the 5-step wizard (`welcome.js`) collects profile, runs the system health check that gives the Python sidecar / SQLite schema time to warm up, surfaces optional LLM/Reddit/Whisper setup, and lands on first-topic / activation. No additional onboarding step needed for the "stall while local SQL initializes" use case — step 3's health check already serves that role.

## Changes

- Issue submission button (settings.js:506) → `https://github.com/myind-ai/openreply/issues`
- Settings "Open README" button (settings.js:1097) → `https://github.com/myind-ai/openreply`
- Settings "Auth docs" button (settings.js:1208) → `https://github.com/myind-ai/openreply#readme`
- Onboarding Reddit setup-guide button (welcome.js:470) → `https://github.com/myind-ai/openreply#readme`
- Sidebar Help & docs link (index.html:151) → `https://github.com/myind-ai/openreply`

Note: the prebuilt bundles under `app-tauri/dist/` still contain the old URLs; they will be replaced on the next `npm run build`. Source is the source of truth.

## Files Modified

- `app-tauri/index.html` — sidebar Help & docs href
- `app-tauri/src/screens/settings.js` — feedback bug-report button, btn-open-readme, btn-auth-docs
- `app-tauri/src/screens/welcome.js` — onboarding Reddit setup-guide button
