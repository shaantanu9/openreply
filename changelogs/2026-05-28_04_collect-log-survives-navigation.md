# Collect log survives navigation — module-scope global progress listener

**Date:** 2026-05-28
**Type:** Fix

## Summary

When a collect was running in the background and the user navigated away (to Home, Settings, Audience, /collects, etc.) and then returned to `#/collect/<topic>`, the live log appeared to "restart" — the "Now: Starting up…" placeholder showed, then new lines started ticking in, but every log line emitted while the user was on another page was silently lost.

Root cause: the `collect:progress` listener (`api.onCollectProgress`) was registered inside `renderCollect`, and the cleanup function removed it on `hashchange`. While the user was on any non-collect screen, the Python sidecar kept emitting `collect:progress` events but no JS subscriber was listening — Tauri broadcasts them and they get dropped. The persistent `_collectLogs` Map was only ever populated through `appendLine`, which is closed over the per-mount `topic` and only callable inside `renderCollect`. Rust kept no durable buffer either (only a 40-line tail in `recent_lines` used for failure classification at `cli.rs:970`).

Fix: lift the progress + done listeners to module scope so they bind once at module load and stay alive across navigation. The global progress handler pushes every line into `_collectLogs[_activeTopic]` regardless of which screen is mounted, then re-dispatches as a `gapmap:collect-line` DOM event for the mounted UI to render. The collect screen now listens to that DOM event (with `appendLine(line, cls, { persist: false })` so it doesn't double-persist) instead of subscribing to `collect:progress` directly. On revisit, the "Now" banner and status sub-line are also seeded from the last meaningful persisted line so the banner no longer stares at "Starting up…" until the next live event lands.

Bonus: the /collects manager's `getCollectSnapshot()` now reflects fresh tail lines for every running topic even if the user never visited the corresponding collect screen.

## Changes

- Added module-scope `_activeTopic` + `bindGlobalCollectListeners()` in `app-tauri/src/screens/collect.js` — binds once on module load, drives persistence and DOM re-dispatch.
- Exported `setActiveCollectTopic(topic)` / `getActiveCollectTopic()` so callers in `renderCollect` and (future) external paths can set the attribution target.
- Replaced the per-screen `api.onCollectProgress` listener with a `window` event listener on `gapmap:collect-line`. The per-screen handler now calls `appendLine(line, cls, { persist: false })` to avoid double-pushing into `_collectLogs`.
- Set `_activeTopic` on every code path where a collect attaches: fresh start, `already_running`, unstick, cancel-and-start, and on mount if `_collectStatus.get(topic) === 'running'`.
- Seed `nowText` + `sub.textContent` from the last persisted line on revisit so the "Now" banner immediately reflects the latest known activity.

Note: the existing `api.onCollectDone` per-screen listener that runs the post-collect chain (build_graph → enrich → export → refresh insights) is still per-screen — that work is now triggered both by the global done listener (which stamps `_collectStatus`) and the local one (which runs the chain when the screen is mounted at completion). The pre-existing "graph build chain doesn't run if user is off-screen at done-time" limitation is unchanged; tracking that separately.

## Files Modified

- `app-tauri/src/screens/collect.js` — module-scope global listener, DOM-event-based per-screen progress handler, `_activeTopic` set on every attach path, "Now" banner seeded from persisted tail on revisit.
