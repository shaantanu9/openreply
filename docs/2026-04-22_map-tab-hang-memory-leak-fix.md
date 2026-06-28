# 2026-04-22 - Map Tab Hang + Memory Leak Fix

## Summary

Fixed a critical issue where opening the **Map** tab in `app-tauri/src/screens/topic.js`
could hang indefinitely, continuously show loading UI, and drive high memory usage.

## User-Visible Symptoms

- Map tab stuck on loading spinner (`Building gap map...` / `Exporting viewer...`)
- App memory keeps increasing while map stays open
- UI appears frozen or slow after repeated tab switches
- Reactive updates make map feel like it is constantly reloading

## Root Cause

Two compounding problems:

1. **Re-entrant `loadMap()` executions**
   - Multiple calls to `loadMap()` could overlap (rapid tab switching, retries,
     reactive events), each spawning heavy async operations:
     - build graph
     - relate graph
     - export HTML
     - iframe refresh
   - Overlap caused sidecar job pileups and memory pressure.

2. **Map auto-refresh loop from `openreply:changed`**
   - Reactive mutation handler could re-trigger current tab reload while map
     was already busy.
   - This amplified concurrent map work and made hangs more likely.

## Code Changes

### 1) Added map load re-entry guard

File: `app-tauri/src/screens/topic.js`

Added per-render flags:

- `mapLoadInFlight`
- `mapReloadQueued`
- `mapReloadQueuedForce`

Behavior:

- If `loadMap(force)` is called while in-flight:
  - do not start another map pipeline
  - queue one follow-up reload and return
- In `finally`:
  - clear in-flight flag
  - run exactly one queued reload if user is still on map tab

### 2) Prevent reactive map reload loops

File: `app-tauri/src/screens/topic.js`

In `onOpenreplyChangedTask8` refresh block:

- Skip automatic `switchTab(curr)` when `curr === 'map'`.
- Map tab now controls its own refresh cycle rather than being force-reloaded by
  every mutation event.

## Why This Fix Works

- Removes unbounded concurrency for the heaviest tab in the app.
- Preserves responsiveness by allowing only one active map pipeline at a time.
- Still keeps map data fresh by queueing one follow-up reload when needed.
- Breaks self-triggered refresh loops from mutation events.

## Validation Performed

- Rust backend compile sanity check (`cargo check -q`) passed after patch.
- Manual expected behavior:
  - opening map no longer starts overlapping load pipelines
  - repeated triggers queue one safe reload instead of spawning many
  - map does not auto-loop reload on every `openreply:changed` event

## Regression Checklist

When validating future changes to map behavior:

1. Open topic -> Map tab and wait for first full render.
2. Trigger collect/enrich while staying on map.
3. Confirm:
   - no infinite loading
   - no repeated toolbar re-mount loops
   - memory growth stabilizes after initial render
4. Click Map/Report/Evidence rapidly and verify map still resolves.

## Preventive Rule (carry forward)

For heavy iframe/graph tabs:

- Always add in-flight + queued reload guards.
- Never allow reactive global event handlers to force-reload the same heavy tab
  while its own loader is active.
- Enforce hard timeouts around external/sidecar export calls and display retry UI.

