# External-Writer Sync + Activation-Flag Heal

**Date:** 2026-04-24
**Type:** Fix

## Summary

User ran MCP tools (`Reddit Find Existing Topic`, `Reddit Research Collect`)
and confirmed they successfully wrote to the shared SQLite. The GUI
wasn't showing any of that data. Two distinct bugs combined:

1. **Stale nav counters + home grid after external writes.** The
   DB-mtime poller already dispatched `openreply:db-changed` on external
   change, but `main.js` only listened for `openreply:changed`. Cache got
   invalidated but no re-render happened.
2. **Activation state drift between disk and localStorage.** The user
   had a valid `license_state.json` on disk (server returned 200 on
   activate, JWT saved, `activated: true` reported by `license_status`)
   — but the localStorage flag `openreply.license.activated` wasn't set.
   `mustStayInOnboarding()` reads localStorage synchronously, so every
   `route()` call redirected to `/welcome`, blocking the home/topics
   view the MCP had populated.

## Fixes

### 1. External-writer bridge (`app-tauri/src/main.js`)

Added a second listener that mirrors the in-app reactive path for
external DB writes:

```js
window.addEventListener('openreply:db-changed', () => {
  refreshNavCounts();
  const onCollectRoute = /^#\/collect\/[^/]+/.test(location.hash || '');
  const onTopicRoute = /^#\/topic\/[^/?]+/.test(location.hash || '');
  if (onCollectRoute || onTopicRoute) return;
  try { localStorage.removeItem('openreply.dashboard.cache.v1'); } catch {}
  route();
  api.startExtractionWorker().catch(() => {});
});
```

Now when the MCP server, CLI, or any external process touches
`reddit.db`, the poller catches it within 5 s, dispatches the event,
and the home grid + sidebar counters refresh automatically. Collect /
topic routes skip the remount to protect in-place tab state (same
contract as `openreply:changed`).

### 2. Activation-flag heal (`app-tauri/src/main.js`)

New `healActivationFlagsFromBackend()` runs before the first `route()`
call in `DOMContentLoaded`. Source of truth is `license_state.json` on
disk — asks Rust via `api.licenseStatus()`; if `activated: true`, sets
the three localStorage keys that the sync `mustStayInOnboarding()`
guard reads. Fixes the boot-loop where a valid on-disk licence was
ignored because localStorage had been cleared / the flag had never
been written.

Also dispatches `openreply:changed` post-heal so any already-mounted
screens re-render under the correct authentication state.

## Verified

- `license_state.json` on the user's machine: `activated: true,
  license_id: fe3db956-…, email: desktop-test+1776…@openreply-dev.local`
- SQLite at `~/Library/Application Support/com.shantanu.openreply/reddit-myind/reddit.db`
  has 13 topics, 28,632 posts — written by the MCP server within the
  last 10 min
- `db_mtime` command polls the exact same path (`data_dir().join("reddit.db")`
  where `data_dir` already appends `reddit-myind`)
- Vite HMR applied both edits; main.js served by vite contains the
  new functions (grep -c → 2)

## Files Modified

- `app-tauri/src/main.js`
  - Added `healActivationFlagsFromBackend()` + await on boot
  - Added `openreply:db-changed` listener that mirrors the
    `openreply:changed` re-render path
