# Topic Tabs + Map/Evidence Stability Fix (2026-04-22)

This note documents the fixes applied for topic-page tab instability, map/evidence hangs, and inconsistent collect action footer states.

## Problem Summary

Observed issues:

- Clicking `Map` sometimes bounced back to `Home`.
- Topic tabs intermittently felt non-clickable.
- `Map` and `Evidence` could stay on loading forever.
- Collect footer sometimes showed mixed button states (e.g. `Retry` + `Open gap map`) until manual refresh.
- Activity page could hang on first open after onboarding.

These were caused by a mix of route remount races, stale listener writes, and unbounded async waits.

## Root Causes

1. **Route remount while inside topic page**
   - Global `gapmap:changed` handler in `app-tauri/src/main.js` called `route()` for topic-relevant mutations.
   - That remounted `#/topic/...` and reset tab state to default (`Home`), making `Map` appear to "not click".

2. **Collect screen stale instance writes**
   - During collect flow, stale callbacks could mutate the wrong DOM instance.
   - Action footer buttons could become inconsistent.

3. **Unbounded tab/data loaders**
   - `runQuery`/export paths in `Map`, `Evidence`, and `Activity` had no hard timeout.
   - If sidecar/db got slow or blocked, UI could spin forever.

4. **Tab click robustness**
   - Per-button listeners are easier to break under rapid remount/reflow.
   - Needed delegated click handling and stronger tab-state persistence.

## Fixes Applied

### 1) Stop topic route remounts from global reactive refresh

File: `app-tauri/src/main.js`

- In the `gapmap:changed` reactive handler:
  - skip `route()` when current route is `#/collect/...` (already done)
  - **also skip `route()` when current route is `#/topic/...`**
- Topic screen now owns in-place refresh without being remounted by the global router.

### 2) Persist selected tab per topic

File: `app-tauri/src/screens/topic.js`

- Added per-topic session key:
  - `gapmap.topic.tab.<topic>`
- On `switchTab(name)`, store selected tab in `sessionStorage`.
- On render, restore remembered tab first; only use intent preset default when no remembered tab exists.

### 3) Make tab click capture deterministic

File: `app-tauri/src/screens/topic.js`

- Updated tab markup to explicit `type="button"` for all topic tab buttons.
- Replaced per-tab individual handlers with one delegated listener on `#topic-tabs`:
  - catches clicks on icon/text inside tab reliably
  - reduces remount edge-cases.

### 4) Add hard timeouts to prevent infinite loading

Files:

- `app-tauri/src/screens/topic.js`
- `app-tauri/src/screens/activity.js`

Added timeout wrappers and used them around critical calls:

- topic stats query
- map graph stats query
- map export
- evidence combined findings query
- activity list/spark/live queries

Result: if sidecar/db stalls, UI shows a visible error state with retry path instead of spinning forever.

### 5) Harden collect action footer updates

File: `app-tauri/src/screens/collect.js`

- `showRetryAction()` now:
  - verifies screen is still mounted (`stillHere()`)
  - scopes DOM lookups to current `root` (instead of global lookup)
- Prevents stale callback from injecting buttons into wrong instance.

## Licensing/MCP gating fixes included in same pass

Additional hardening done during the same session:

- MCP commands are activation-gated in Rust backend:
  - `mcp_clients`, `mcp_status`, `mcp_install`, `mcp_uninstall` require valid activation.
- Settings MCP card now shows locked state until activation.

## Env setup improvements included in same pass

- Rust Tauri runtime now reads dotenv files on startup.
- `app-tauri/.env` normalized to dotenv format (`KEY=value`) instead of shell `export`.
- License API base can come from env (`GAPMAP_LICENSE_API_BASE` or `LICENSE_API_BASE`) and onboarding pre-fills from it.

## Validation Checklist

Run this checklist after restarting app:

1. Open any topic.
2. Click `Map`, `Evidence`, `Sources`, `Posts`, `Research`, `Chat` rapidly.
3. Verify active tab stays where clicked (no bounce to Home).
4. Start collect and watch footer actions; ensure no mixed/duplicated button states.
5. Open Activity right after onboarding; confirm no infinite loading.
6. If sidecar is slow, verify timeout error appears (with retry) instead of permanent spinner.

## If issue reappears

Capture:

- current hash route (e.g. `#/topic/<slug>`)
- tab clicked
- whether collect/enrich was active
- any timeout/error text shown in tab

Then check:

- `app-tauri/src/main.js` reactive route guard
- `app-tauri/src/screens/topic.js` tab restore + delegated click
- `app-tauri/src/screens/collect.js` stale guard (`stillHere`)

