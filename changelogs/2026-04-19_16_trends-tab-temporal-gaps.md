# Trends Tab — Temporal Gaps (Chronic / Emerging / Fading)

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added a new "Trends" tab to the topic screen that surfaces the existing `reddit-cli research temporal-gaps` classifier. The tab renders a three-column grid — CHRONIC, EMERGING, FADING — with painpoint cards showing severity badges, evidence quotes, and pre/post-May-2025 frequency counts. Uses the pullpush.io Reddit data cutoff (May 2025) as a natural experiment to classify which pain points are new, persistent, or fading. Includes an empty-state CTA, a Re-run button, and a clear error path for when historical data is missing (prompts user to run collect with `--aggressive`).

## Changes

- New Tauri command `run_temporal_gaps` that calls `reddit-cli research temporal-gaps --topic X --json`
- JS bridge `api.runTemporalGaps(topic)` in api.js
- New screen module `trends.js` exporting `loadTrends(contentEl, topic)`
- Trends tab button inserted between Evidence and Sources in topic.js tab bar
- `trends` loader registered in the loaders map in topic.js
- CSS for `.trends-grid`, `.trends-col`, `.trends-card`, `.trends-sev`, `.trends-freq`, `.trends-evidence` appended to style.css

## Files Created

- `app-tauri/src/screens/trends.js`

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — added `run_temporal_gaps` command
- `app-tauri/src-tauri/src/main.rs` — registered `commands::run_temporal_gaps` in handler
- `app-tauri/src/api.js` — added `runTemporalGaps` wrapper
- `app-tauri/src/screens/topic.js` — import, tab button, loaders map entry
- `app-tauri/src/style.css` — appended Trends tab CSS rules
