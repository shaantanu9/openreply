---
name: map-tab-memory-guard
description: Prevent Map tab hangs, loading loops, and memory spikes caused by overlapping loadMap runs in topic.js.
---

# Map Tab Memory Guard Skill

Use this skill when users report:

- "Map tab keeps loading forever"
- "Opening map hangs app"
- "Memory leak when map tab is open"
- "Map refreshes repeatedly by itself"

## Core Rule

`loadMap()` in `app-tauri/src/screens/topic.js` must be **single-flight**.

Never allow concurrent map pipelines (build/relate/export/enrich/iframe reload)
to run at the same time.

## Mandatory Implementation Pattern

Inside `renderTopic(...)` scope:

1. Add guard flags:
   - `mapLoadInFlight`
   - `mapReloadQueued`
   - `mapReloadQueuedForce`
2. At start of `loadMap(force)`:
   - if in-flight: set queued flags and return
3. In `finally`:
   - clear in-flight
   - run one queued reload only if still on map tab

## Reactive Events Rule

In `onOpenreplyChangedTask8`:

- If current tab is `map`, skip generic `switchTab(curr)` refresh.
- Map tab must own its own refresh logic.

Reason: event-driven auto-refresh can recursively re-trigger map loader and
create sidecar + memory pressure loops.

## Timeout Rule

For map export/build/relation calls:

- Use bounded timeouts
- Show actionable fallback UI on timeout
- Do not leave user on permanent spinner state

## Validation Steps

1. Open topic -> map tab.
2. Trigger collect/enrich updates while map is open.
3. Rapidly switch tabs and return to map.
4. Confirm:
   - only one map pipeline at a time
   - no infinite loading
   - no runaway memory growth pattern
   - map can recover with retry button on failures

