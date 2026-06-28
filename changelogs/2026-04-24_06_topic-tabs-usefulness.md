# Topic-tab usefulness — Run all + freshness + auto-run

**Date:** 2026-04-24
**Type:** Feature + UI Enhancement

## Summary

Users reported that most topic tabs (Solutions, Concepts, Trends, Sentiment, Report, Papers, …) appeared broken — they'd open a tab and see an empty state. Audit showed the plumbing was fine: every tab is fully wired JS → Rust → Python. The problem was UX: each tab's data needs its own (often expensive) LLM pipeline to populate the local SQLite cache, but the UI made that invisible. There was no master "Run all", no freshness hints on most tabs, and empty-state CTAs were inconsistent.

This change makes every tab useful and discoverable via three coordinated additions: a central pipeline registry, a master "Run all analyses" button in the Actions tab, and an opt-in auto-run-on-open setting that kicks the right pipeline the first time a user visits an empty tab.

## Changes

- **Central pipeline registry** (`src/lib/tabPipelines.js`) — every tab has one entry describing its label, estimated runtime, LLM requirement, countSql (for freshness/empty checks), and a `run(topic)` function. New helpers: `tabHasData`, `tabCount`, `runTabPipeline`, `runAllForTopic`, `isAutoRunEnabled`, `setAutoRunEnabled`.
- **"Run all analyses" master card** in the Actions tab — prominent, one-click orchestrator that runs graph build → enrich → insights → solutions → concepts → trends → sentiment → report. Streams per-step progress (running / done / error), surfaces a no-LLM-key hint with a Settings deeplink, and continues past per-step failures. Includes an auto-run toggle.
- **Freshness badges on all 15 tabs** — previously only 4 tabs had them. Now every tab shows "Updated Xs ago · N items" where N comes from the registry's countSql. Bets reads from `hypothesisStats`.
- **Auto-run on empty tab open (opt-in)** — when the setting is enabled *and* an LLM provider is configured, opening an empty Home, Solutions, or Concepts tab immediately triggers the relevant pipeline instead of showing a CTA. Falls back to the manual CTA when either gate fails, so we never consume LLM credits against the user's will. Trends, Sentiment, and Report already had this behaviour; Solutions, Concepts, and Home now match.
- **Unified empty-state / running / error helpers** (`src/lib/tabEmpty.js`) — `renderEmpty`, `renderRunning`, `renderError`, and `classifyError` give consistent empty states across tabs (rate-limit → retry hint, no LLM key → Settings deeplink, credits → switch-provider suggestion).

## Known gaps

- GUI-driven pipelines (`run_solutions_pipeline`, `run_concepts`, etc.) don't yet write audit rows to `mcp_analyses` themselves — only MCP-server tools call `save_mcp_analysis`. Adding write-through requires a new Rust command (`run_query` is read-only by design) plus a Python CLI change. The AI Analyses tab still populates from MCP tool invocations.

## Files Created

- `src/lib/tabPipelines.js` — registry + orchestrator
- `src/lib/tabEmpty.js` — shared empty/running/error render helpers

## Files Modified

- `src/screens/topic.js` — imports new modules; adds `tab-freshness` spans for every remaining tab; wires 11 new freshness badges; inserts the "Run all analyses" master card and handler into `loadActions`; persists per-run step progress with `dirtyTabs` flagging so affected tabs re-render on revisit.
- `src/screens/solutions.js` — empty-state CTA now auto-triggers the pipeline when `isAutoRunEnabled() && hasLlmConfigured()`; button remains the manual fallback.
- `src/screens/concepts.js` — same auto-run pattern.
- `src/screens/insights.js` — Home tab's "Generate insights" CTA now auto-runs under the same gate.
