# Competitor Intelligence 3-tab screen + route + nav

**Date:** 2026-07-01
**Type:** Feature

## Summary

Added the `renderCompetitors` screen to `dynamic.js` — a three-tab Competitor Intelligence view (Opportunities, Complaints, Comparison) wired to the `api.competitor*` backend commands from Task 11. Registered the route in the `DYN` export and added a sidebar nav entry in `shell.js` under the Intelligence section.

## Changes

- Implemented `renderCompetitors(view)` with three inner painter functions (`paintOpps`, `paintComplaints`, `paintCompare`) and shared helpers `paintError`/`emptyAgentMsg`
- Each tab implements four UI states: loading (`skelCardsN`), empty (friendly message + icon), error (rose box + Retry button), data
- Tab 1 (Opportunities): calls `api.competitorOpportunities(pid)` → cards with severity badge, suggested action, evidence post-id chips, "Draft reply" + "Build this" buttons (v1 toast + TODO)
- Tab 2 (Complaints): competitor switcher from `api.competitorList(pid)` → `api.competitorFindings(pid, name)` → findings grouped by topic/cluster with delta indicator and per-competitor Refresh button
- Tab 3 (Comparison): `api.competitorCompare(pid)` → responsive overflow-scrollable table with You/competitor rows (sentiment, complaint_count, share_of_voice)
- Refresh-all header button reruns every tracked competitor via `Promise.allSettled`
- Registered `competitors: renderCompetitors` in the `DYN` export object
- Added `['competitors', 'target', 'Competitors']` as first item in the Intelligence nav section

## Files Created

- `changelogs/2026-07-01_03_competitor-intelligence-screen.md` (this file)

## Files Modified

- `app-tauri/src/or/dynamic.js` — added `renderCompetitors` function (~245 lines) + `competitors` DYN key
- `app-tauri/src/or/shell.js` — added competitors nav entry in Intelligence section
