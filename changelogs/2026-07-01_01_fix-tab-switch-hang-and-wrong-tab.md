# Fix tab switching hanging and showing the wrong tab

**Date:** 2026-07-01
**Type:** Fix

## Summary

After the per-(tab,hash) portal cache landed, switching tabs could hang (a tab
never loads) and sometimes show the wrong tab's content. Two root causes in
`main.js`, both in the render/tab machinery.

## Changes

### 1. Tab hangs / never loads
`render()` serialized per-tab renders by chaining each on the previous render's
promise (`previous.then(...)`). Every screen cold-spawns the Python sidecar, and
if a render's `await DYN[key](portal)` stalled, that promise never resolved — so
its cleanup never ran and **every later navigation to that tab chained onto the
stuck promise and never executed**, freezing the tab permanently. A render that
threw outside the inner try/catch similarly skipped the next chained render.

Replaced the promise-chain with a **per-tab generation counter** (`tabRenderGen`):
each render bumps the counter and bails at its `await` points if a newer render
superseded it. Latest-render-wins, and a stalled render can no longer block
future navigations.

### 2. Wrong tab shown
The activation subscription only re-rendered when `location.hash !== active.hash`.
Focusing a tab that shares the current hash (two tabs on the same screen) didn't
re-render, so the previous tab's portal stayed visible while the strip showed the
new tab as active.

The subscription now also re-renders when the **active tab id changes** (or the
tab was reloaded) even if the hash is unchanged — tracked via `lastActiveId` /
`lastReloadTs` so it can't loop with the `setTitle()` call at the end of
`render()`.

## Files Modified

- `app-tauri/src/main.js` — `render()` generation-based supersession (replaces the
  hang-prone promise queue); activation subscription re-renders on active-tab /
  reload change; `tabRenderQueue` → `tabRenderGen`.

## Notes

- Verified with `node --check`.
- No behavior change for the normal path (different-hash navigation); this only
  removes the freeze and the stale-portal cases.
