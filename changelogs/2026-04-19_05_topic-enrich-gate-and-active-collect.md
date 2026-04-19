# Topic Map enrich gate + active-collect indicators

**Date:** 2026-04-19
**Type:** Fix | UI Enhancement

## Summary

Painpoints, feature wishes, workarounds, and products were missing from the Topic screen because `loadMap` only ran the structural `build_graph` step and silently dropped errors — enrichment (the LLM-driven step that populates those semantic nodes) only ever ran once, at the end of the `collect` flow. If no LLM key was configured then, the user got a permanently empty map with no recovery path. Visibility into ongoing research was also poor: `collectStatus` existed but wasn't consumed, and the Activity feed showed "✓ ok" for rows that were still running.

## Changes

- Map tab now auto-enriches when it has a usable LLM key and zero findings.
- Added an **Enrich** button to the Map toolbar so users can re-run extraction at any time.
- Added a **findings** chip next to the map filename so a zero state is visible at a glance.
- Map tab stops swallowing `buildGraph` errors — failures now surface in the empty-state with the real error message and a retry button.
- Added an in-line banner above the iframe describing why enrichment was skipped / failed / found nothing, with an inline "Add key" CTA when no BYOK is set.
- Added a **Collecting…** chip to the topic page header that polls `fetches.ended_at IS NULL` every 4s and deep-links to `#/collect/{topic}`.
- Home dashboard's active-collect banner now polls every 4s (was one-shot). Also refreshes Activity / Topic grid / Hero stats once a run finishes so post-collect numbers are current without a page reload.
- Activity feed rows (on Home and in the full Activity table) now show a pulsing **running** pill with a live-updating duration instead of "✓ ok" for in-flight fetches.

## Files Created

- `changelogs/2026-04-19_05_topic-enrich-gate-and-active-collect.md`

## Files Modified

- `app-tauri/src/screens/topic.js` — loadMap rewritten with enrichment gate, surfaced errors, enrich button, findings chip; `renderTopic` adds `topic-active-chip` polling.
- `app-tauri/src/screens/home.js` — `loadActiveCollect` now polls; `activityItem` renders running pill when `ended_at` is null.
- `app-tauri/src/screens/activity.js` — `activityRow` renders running pill + live duration when `ended_at` is null.
- `app-tauri/src/style.css` — new `.map-enrich-banner`, `.pulse-dot.sm`, `.pill-running`, `.topic-active-chip`, `.activity-item.is-running` styles.
