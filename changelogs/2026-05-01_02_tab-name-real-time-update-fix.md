# Tab strip — fix stale title until clicked

**Date:** 2026-05-01
**Type:** Fix

## Summary

When the user clicked a sidebar link (which mutates `location.hash`
directly), the active tab's URL was rewritten in-place but the tab
strip continued to show the old title until the user clicked a tab —
forcing a `focus()` which was the next event that called the store's
`notify()`.

Root cause: the router's reconcile path in `app-tauri/src/main.js`
was bypassing the tab store's public API and writing to localStorage
directly to "avoid a notify loop." After the manual write, the next
attempt to update the title via `tabStore.setTitle()` short-circuited
because the title field was already correct, so no notify ever fired.
The strip stayed stale until any other tab event eventually called
`notify`.

## Changes

- Added `tabStore.replaceHash(id, hash)` in
  `app-tauri/src/lib/tabs.js`. Updates `hash + title + icon` and
  always calls `notify()`. Replaces the inline localStorage rewrite
  in `main.js`.
- `app-tauri/src/main.js` route reconcile now calls
  `tabStore.replaceHash(active.id, fullHash)` instead of poking
  localStorage directly. The `notify()` triggered by replaceHash
  re-renders the tab strip with the new title in real time, no click
  required.

The subscriber feedback loop the prior code feared isn't actually a
loop: subscribers compare `location.hash` to `active.hash` and only
trigger a re-route when they differ. After replaceHash, both are
already equal to `fullHash`, so the subscriber is a no-op.

## Files Created

- `changelogs/2026-05-01_02_tab-name-real-time-update-fix.md`
- `docs/manual-todo/mcp-future-scope.md` (separate context — captures
  the deferred MCP items the user asked to file as future scope)

## Files Modified

- `app-tauri/src/lib/tabs.js` — added `replaceHash(id, hash)` method.
- `app-tauri/src/main.js` — route reconcile uses `replaceHash` instead
  of direct localStorage write.

## Manual verification

1. Open the desktop app on the home screen (or any non-topic screen).
2. Click a topic in the sidebar.
3. **Expected:** tab title in the strip updates to the topic name
   immediately, no click on the tab needed.
4. **Before this fix:** tab title kept showing the previous screen's
   title until you clicked the tab.
