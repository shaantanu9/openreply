---
name: topic-tab-stability
description: Fix topic tab click bounces, map/evidence infinite loading, and collect action footer state races in the Tauri app.
---

# Topic Tab Stability Skill

Use this when users report:

- "Map tab not clickable"
- "Clicking Map returns to Home"
- "Topic tabs reload/reset randomly"
- "Map/Evidence loading forever"
- "Collect footer shows wrong/mixed buttons"

## Goals

1. Keep tab selection stable while data updates stream in.
2. Prevent global route remount from resetting topic tab state.
3. Ensure every tab either loads data or shows an actionable error state.
4. Prevent stale async callbacks from mutating unmounted screens.

## Required Checks

### 0) Map memory/re-entry guard (critical)

In `app-tauri/src/screens/topic.js` `loadMap(...)`:

- Add in-flight guard flags:
  - `mapLoadInFlight`
  - `mapReloadQueued`
  - `mapReloadQueuedForce`
- If `loadMap` is called while already running:
  - do **not** start another export/build/enrich pipeline
  - set queued flags and return immediately
- In `finally`, run exactly one queued reload if still on map tab.

Why: without this, rapid clicks + reactive events can stack map exports and
enrich runs, causing high memory usage, sidecar pileups, and "loading forever".

### 1) Router remount guard (critical)

Inspect `app-tauri/src/main.js` `openreply:changed` listener.

- If current route is `#/topic/...`, do **not** call global `route()`.
- Topic page must handle its own in-place refresh logic.

Without this, map click appears broken because topic remount resets active tab.

### 2) Tab interaction robustness

In `app-tauri/src/screens/topic.js`:

- Tab buttons should be `type="button"`.
- Use delegated click handling on `#topic-tabs`:
  - `const btn = e.target.closest('.tab[data-tab]')`
  - call `switchTab(btn.dataset.tab)`.

This avoids per-button listener drift on rapid re-renders.

### 3) Per-topic tab persistence

In `topic.js`:

- Persist selected tab in `sessionStorage` key:
  - `openreply.topic.tab.<topic>`
- Restore remembered tab on render before falling back to intent default.

### 4) Timeout guards for heavy tab loaders

Add `withTimeout(...)` and apply to:

- topic stats query
- map graph stats
- map export
- evidence combined findings query
- activity page core queries

Target behavior: no infinite spinner; show explicit timeout/error + retry.

Also ensure map export has a hard timeout and fallback UI; never allow
"Exporting viewer..." to run indefinitely.

### 4.5) Reactive event loop guard for map

In the `openreply:changed` refresh path:

- If current tab is `map`, skip `switchTab('map')` auto-refresh loops.
- Let map tab own its own refresh/reload cycle.

Why: enrich/build emits mutations; if each mutation re-calls map loader, this
can create a self-triggered reload loop and memory pressure.

### 5) Stale callback guards

In collect/topic loaders:

- Gate async UI writes with mounted checks (`stillHere`, routeGen/data-tab checks).
- Scope DOM queries to current root/container (avoid global selectors for stateful actions).

This prevents mixed footer button states and stale writes.

### 6) Chrome-style sticky tab strip (layout shell guard)

If users report "tab bar scrolls away" or "tabs are not sticky like Chrome", verify shell scroll ownership in `app-tauri/src/style.css`:

- `html` and `body` must be non-scrolling:
  - `html { overflow: hidden; }`
  - `body { overflow: hidden; }`
- `.app` should own full viewport and not scroll:
  - `height: 100vh`
  - `overflow: hidden`
- `.main-col` is a fixed shell column:
  - `height: 100vh`
  - `overflow: hidden`
- `main.main` must be the only vertical scroll container:
  - `overflow-y: auto`
  - `height: 100%`
  - `min-height: 0`
- `#tab-strip` remains pinned at top:
  - `position: sticky`
  - `top: 0`
  - non-transparent background + z-index

Without this shell contract, body/window scrolling can take over and the tab strip appears to move with content.

## Validation Steps

1. Open topic.
2. Click tabs quickly: Home, Map, Evidence, Sources, Posts, Research, Chat.
3. Confirm active tab does not jump back to Home.
4. Start collect and confirm action footer is consistent.
5. Simulate slowness; verify timeout error appears instead of hanging forever.
6. Scroll long pages and confirm only content area scrolls while top tab strip stays fixed.

## Success Criteria

- Tab clicks always register.
- Map stays on Map after click.
- Evidence loads or fails visibly.
- No random topic remount on reactive events.
- No mixed action footer states during collect.

