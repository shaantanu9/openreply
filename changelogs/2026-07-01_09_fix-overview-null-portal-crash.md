# Fix Overview/Knowledge/Geo/Subreddit crash: null portal after slow sidecar await

**Date:** 2026-07-01
**Type:** Fix

## Summary

The Agent (Overview) screen crashed with
`TypeError: null is not an object (evaluating 'document.getElementById("ov").outerHTML = …')`
at `dynamic.js`, rendering a red error box instead of the dashboard. Root
cause: the render sets `view.innerHTML = '<div id="ov">…'`, then `await`s
`agentGet()` + `agentKnowledge()`. Those sidecar calls now take multiple
seconds, and `main.js`'s latest-render-wins logic wipes `portal.innerHTML`
when a newer render (or navigation) starts during the await. The code then
did a **global** `document.getElementById("ov")` — which returns `null` once
the node has left the document — and dereferenced `.outerHTML`, crashing.

Fix: scope every post-await DOM lookup to the passed `view` and bail out when
the skeleton node is gone (a superseded render must never write to a
detached/replaced portal). Applied the same guard to every render function
with the identical "global `getElementById(...)` dereferenced after an
`await`" pattern.

## Changes

- `renderOverview`: `#ov` lookups scoped to `view` with a null-bail after each
  await (`agentGet`, `agentKnowledge`); the "No active agent" branch and the
  final `.outerHTML` write are both guarded.
- `renderKnowledge`: same fix for `#kn` (identical twin bug).
- `renderGeo` `load()`: `#geo-list` captured via `view.querySelector` with an
  early bail after `await api.geoList()`; `#geo-kpi`, `#geo-trend`, and the
  catch-branch `#geo-list` write scoped + guarded (removed the unguarded
  `const list = document.getElementById(...)` that could also crash on
  `list.innerHTML`).
- `renderSubredditFull`: `#sr-acct` write guarded; added a bail before wiring
  `#sr-disc`/`#sr-go`/`#sr-add`/`#sr-q` handlers (an unguarded
  `document.getElementById("sr-disc").onclick` after the status await was a
  hard crash if the view was torn down).

Verified `ch-list`/`al-list` sites are already safe (null-guarded or captured
before the await), so no change needed there.

## Verification

- `node --check src/or/dynamic.js` → syntax OK.
- Only remaining match for the crashing pattern is an explanatory comment.
- App running in dev; Vite HMR page-reloaded `dynamic.js` — the fix is live.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `renderOverview`, `renderKnowledge`,
  `renderGeo`, `renderSubredditFull` post-await DOM writes scoped to `view`
  and null-guarded.
