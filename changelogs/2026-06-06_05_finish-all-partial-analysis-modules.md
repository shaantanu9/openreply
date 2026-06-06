# Finish all partial analysis modules — cat-14 fully closed

**Date:** 2026-06-06
**Type:** Feature

## Summary

Completes every remaining 🟡 advanced-analysis module so that no analysis
function in Gap Map is half-done. The last 6 cat-14 gaps are closed: **Why
(root-cause / 5-Whys)**, **Sentiment-by-source charts**, **Tactic library**,
**Hypothesis-tracker screen** (via a 4-agent workflow writing disjoint files +
central wiring), and **PERT** + **Idea-scan** (exposed as MCP tools directly).
With this, FEATURES.md category 14 goes 18/18 ✅, and 5 of the overlapping
cat-15 screen rows flip to ✅ as well.

Tracker after this change: **196 features · 190 ✅ · 6 🟡** — the only 🟡 left
are 6 cat-15 Tauri screens with viz/polish gaps (not breakage): Graph faceted
filtering, Insights deliberation tiers, Personas polish, Global-Competitors
detail, OST 2×2 matrix, Bets/Tasks/Activity UI.

Build-verified end to end: Python CLI registers `research root-cause` +
`research tactics` and returns JSON, vite builds 1800 modules, `cargo check`
reports 0 errors.

## Changes

- **Why root-cause (NEW):** `research/root_cause.py` (`root_cause_get` pure read
  + `root_cause_compute` runs a 5-Whys ladder per top painpoint on
  `strategy_common`, persists to `strategy_artifacts`); `screens/root_cause.js`
  (laddered whys + root-cause + addressable chip); CLI `research root-cause
  [--compute]`; Rust `root_cause_get`/`root_cause_compute`; api
  `rootCauseGet`/`rootCauseCompute`; **Root Cause** tab.
- **Sentiment-by-source charts:** added per-source comparison charts to the
  existing `screens/sentiment.js` (the documented "charts" gap; backend +
  tab already existed).
- **Tactic library:** `research/tactic_library.tactics_for_topic()` matches the
  seeded tactic library to the topic's painpoints; `screens/tactics.js`; CLI
  `research tactics`; Rust `tactics_get`; api `tacticsGet`; **Tactics** tab.
- **Hypothesis tracker:** `screens/hypotheses.js` (status summary + per-item
  status update + delete) on the EXISTING `hypothesis_*` Rust + api surface;
  **Hypotheses** tab (no new backend).
- **PERT MCP tools:** `gapmap_pert_list`, `gapmap_pert_add_task`,
  `gapmap_pert_rollup` wrapping `research/pert.py`.
- **Idea-scan MCP tools:** `gapmap_idea_scan_start` (under the timeout guard +
  jobs-queue fallback), `gapmap_idea_scan_get`, `gapmap_idea_scan_list`.

## Files Created

- `src/gapmap/research/root_cause.py`
- `app-tauri/src/screens/root_cause.js`
- `app-tauri/src/screens/tactics.js`
- `app-tauri/src/screens/hypotheses.js`

## Files Modified

- `src/gapmap/research/tactic_library.py` — `tactics_for_topic()`.
- `app-tauri/src/screens/sentiment.js` — per-source comparison charts.
- `src/gapmap/mcp/server.py` — 6 new MCP tools (PERT ×3, idea-scan ×3).
- `src/gapmap/cli/main.py` — `research root-cause`, `research tactics`.
- `app-tauri/src-tauri/src/commands.rs` + `main.rs` — `root_cause_get/_compute`,
  `tactics_get`.
- `app-tauri/src/api.js` — `rootCauseGet/Compute`, `tacticsGet`.
- `app-tauri/src/screens/topic.js` — 3 imports, 3 tabs, 3 loaders.
- `FEATURES.md` — cat 14 → 18/18 ✅, cat 15 → 19/25 (6 🟡), Total 196 · 190 ✅ · 6 🟡,
  tool count 153, rollup + session-changes updated.
- `docs/BUILD-PROGRESS.md` — remaining-🟡 section flipped ✅.

## Known gaps

- The cat-14 / cat-17 modules that are Tauri-only still lack MCP tools (P2).
- 6 cat-15 screens remain viz/polish-incomplete (P1, not breakage).
