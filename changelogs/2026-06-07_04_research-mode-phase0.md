# Research Mode — Phase 0 (App Mode + Research Home + conditional nav)

**Date:** 2026-06-07
**Type:** Feature

## Summary

First slice of the "researcher/PhD heaven" build (spec:
`docs/superpowers/specs/2026-06-07-research-mode-design.md`). Introduces a
frontend **App Mode** (`product` | `research`) chosen in Settings, a dedicated
**Research Home** front door, mode-aware navigation, and a `labels()` helper that
relabels "Topic" → "Project" in research mode. Fully additive and reversible —
no backend/Rust rebuild required (App Mode is a localStorage preference); the
Python side can read `APP_MODE` later when a backend behaviour needs it.

Built on top of release **v0.1.22** (the revert point).

## Changes

- **App Mode helper** (`labels.js`): `getAppMode`/`setAppMode`/`isResearch`/
  `labels()` + `RESEARCH_SOURCES`. `setAppMode` persists to localStorage, stamps
  `<html data-app-mode>`, and fires an `appmodechange` event.
- **Research Home** (`screens/research_home.js`): "Start new research" (seeds the
  question into the Research Workspace via sessionStorage), the
  Gather→Read→Synthesize→Write stage strip, and the project (topic) list via
  `api.listTopics()`.
- **Router/nav** (`main.js`, `index.html`): `#/research-home` route; a "Research"
  sidebar entry tagged `data-nav-mode="research"` (hidden in product mode);
  `applyAppModeToDocument()` on boot + `syncNavToAppMode()` re-run on
  `appmodechange`.
- **Settings** (`screens/settings.js`): an "App mode" card (Product gaps /
  Academic research) wired to `setAppMode`, with a confirmation status line.
- **Workspace seed** (`screens/research_workspace.js`): prefills the topic input
  from the Research Home "Begin" seed.

## Verification

- `node --check` passes on all 5 new/edited frontend files.
- Backend untouched (no Python/Rust changes) → no rebuild; existing flows
  unaffected (product mode is the default and renders exactly as before).
- Dogfood corpus ready: 26 papers / 38 full-text / 34 chunked for "binaural
  beats EEG meditation".

## Deferred to next iteration (needs in-app testing)

- `topic.js` stage-bar above the tabs + conditional research/product tab set
  (riskiest surgery on the 1900-line tab system — building with `npm run
  tauri:dev` open).
- Phases 1–4: Reader + highlights/notes + reading status (1), Lit-review matrix
  (2), Citation manager (3), Library + collections (4).

## Files Created

- `app-tauri/src/labels.js`
- `app-tauri/src/screens/research_home.js`
- `changelogs/2026-06-07_04_research-mode-phase0.md`

## Files Modified

- `app-tauri/src/main.js` — route + imports + boot app-mode apply + nav sync.
- `app-tauri/index.html` — Research sidebar entry (`data-nav-mode="research"`).
- `app-tauri/src/screens/settings.js` — App mode card + wiring.
- `app-tauri/src/screens/research_workspace.js` — seed prefill.
