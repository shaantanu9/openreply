# Map tab: in-session render cache — rebuild only on demand or auto-update

**Date:** 2026-04-24
**Type:** Performance + UX

## Summary

Before: every Map-tab visit re-ran the full pipeline — `topicStats` +
graph-stats query + `api.relateGraph` + auto-`enrichGraph` +
`api.exportHtml` + iframe re-render — even when nothing had changed. On
a 7k-post topic with the Python sidecar doing dev-venv Python spawns,
that's ~3 sidecar spawns and 2-8 s per re-visit, making Map feel slow
every time the user bounced around tabs.

Now: a per-topic in-session render cache short-circuits `loadMap()` on
repeat opens. The full pipeline only runs when:
- the user clicks **Rebuild** (or changes Mode — both pass `force=true`),
- `dirtyTabs.has('map')` AND `auto-update` is ON (new data landed and
  the user opted into automatic refresh),
- no cache exists yet (first Map open on a freshly mounted topic page).

When the map is dirty but auto-update is OFF, the cached map is served
with a **⚠ stale** chip appended to the toolbar so the user knows they
can click Rebuild manually.

Everything existing still works — `PERSISTED_CACHEABLE_TABS` + the
`sessionStorage`-based snapshot path in `switchTab()` were already
doing cross-session caching. The new in-session `_mapRender` cache
plugs the one gap they didn't cover: when the sessionStorage snapshot
is missing (first session visit, or the 10-min TTL expired), we don't
need to re-run the sidecar pipeline as long as we've already rendered
the map once in this session.

## Changes

`app-tauri/src/screens/topic.js`:

- New `let _mapRender = null` at the top of `renderTopic()`. Populated
  at the end of a successful `loadMap()` with
  `{ html, outPath, mapMode, ts, stale }`. Closure-scoped to the topic
  page so topic-switches reset it automatically.
- **Cache short-circuit** added at the top of `loadMap()`, after the
  re-entrancy guard and before `invalidateTabCache('map')`. Branches on
  `force`, `dirtyTabs.has('map')`, and `isMapAutoUpdateEnabled()` per
  the rules above.
- **Stale chip injection** — when the cache is served for a dirty map
  (auto-update off), a `[data-stale-chip="1"]` `<span>` is appended to
  `.map-toolbar-info` in-place (not a full toolbar re-render) so the
  iframe's scroll + layout state isn't wiped.
- **Shared button-wiring helper** `_wireMapToolbarButtons(outPath,
  mapMode, mapAutoUpdate)` — called from BOTH the cache-restore path
  and the end of the full-render path. Previously the click handlers
  were inlined at the bottom of `loadMap`; duplicating them in the
  cache path would have been error-prone on future changes.
- At the end of a successful render, populate `_mapRender` and
  `dirtyTabs.delete('map')` so the next visit reads clean.
- `runEnrichFromMap()` now calls `loadMap(true)` instead of
  `loadMap()`. Without `force=true` the new cache would short-circuit
  back to the pre-enrich render, defeating the reason the user clicked
  Enrich.

## Interaction with existing layers

- `switchTab()` already short-circuited Map when a `sessionStorage`
  snapshot existed AND the tab was clean. That still fires first. Only
  when there's no sessionStorage snapshot does the loader run — and
  now my in-session cache catches that case too.
- `NON_CACHEABLE_TABS` still contains `'map'` so the
  `stashTabDom`/`restoreTabDom` DOM-reparenting cache doesn't try to
  clone the iframe (which produced blank renders in earlier attempts).
  My `innerHTML` snapshot approach re-creates a fresh iframe DOM node
  that re-loads the stable `file://` export URL — same visual result,
  no sidecar work.
- `mutated('graph', …)` broadcasts still add `'map'` to `dirtyTabs`.
  The cache respects this via the `dirty` branch.

## Files Modified

- `app-tauri/src/screens/topic.js` — `_mapRender` cache, shared
  `_wireMapToolbarButtons` helper, `loadMap(true)` in enrich path.

## Verification

- `node --input-type=module -e "import('./src/screens/topic.js')"` — OK.
- `cargo check` in `app-tauri/src-tauri` — clean (only pre-existing
  warnings unrelated to this change).

## Behavior Matrix

| Scenario | Before | After |
|---|---|---|
| First Map open on topic | Full pipeline | Full pipeline |
| Re-open Map, clean, within session | Full pipeline | Cache hit (0 spawns) |
| Re-open Map after data mutation, auto=ON | Full pipeline | Full pipeline |
| Re-open Map after data mutation, auto=OFF | Full pipeline | Cache hit + ⚠ stale chip |
| Click Rebuild | Full pipeline | Full pipeline |
| Toggle Mode | Full pipeline | Full pipeline |
| Click Enrich → completes | Full pipeline | Full pipeline |
| Switch to another topic + back | Full pipeline (closure remount) | Full pipeline (closure remount) |
