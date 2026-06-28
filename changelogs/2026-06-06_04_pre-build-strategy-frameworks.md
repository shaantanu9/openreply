# Pre-build strategy frameworks — market sizing, Porter, SWOT, Lean Canvas, Value-Prop, North-Star

**Date:** 2026-06-06
**Type:** Feature

## Summary

Closes the product-strategy coverage gaps identified in
`docs/PRODUCT-DISCOVERY-COVERAGE.md` by shipping the full "before you build"
toolkit a PM/founder uses to judge a market gap — market assessment, strategy,
and business framing — all grounded in the topic's collected evidence
(painpoints, feature-wishes, complaints, competitors, corpus mix). Six new
topic-level frameworks, each with a cheap cached read and an on-demand LLM
synthesis (~30–60s) persisted to a new `strategy_artifacts` table, surfaced as
tabs on the topic page between **Prioritize** and **Bets**.

This directly answers the user's ask to make OpenReply "a proper solution for
anyone who wants to search the gap… get the retail idea, market value, market
cap, market gaps, and whatever a product manager does to find a gap before
starting." Market sizing (TAM/SAM/SOM + market value) was the named P0.

Built via a 6-agent workflow (each agent wrote an isolated Python core + Tauri
screen, no shared-file conflicts) on a shared foundation, then wired centrally.
Build-verified end to end: Python CLI registers all 6 commands and returns JSON,
vite builds 1797 modules, `cargo check` reports 0 errors.

## Changes

- New shared foundation `research/strategy_common.py`: topic-keyed
  `strategy_artifacts` store (`get_artifact`/`put_artifact`), `run_llm_json`
  (provider resolve + tolerant JSON parse + graceful no-LLM degrade), and
  `topic_context`/`context_brief`/`context_is_thin` evidence bundler.
- 6 framework cores (`research/<name>.py`), each exposing `<name>_get` (pure read,
  never raises) + `<name>_compute` (LLM synthesis, persists): market_sizing,
  porter, swot, lean_canvas, value_prop, north_star. Defensive `_normalize` per
  module coerces every field to a safe documented shape.
- 6 Tauri screens (`screens/<name>.js`) mirroring `prioritize.js`: `esc()` on all
  strings, `alive()` tab guard, empty-big "Generate" compute state with spinner,
  computed render + "Regenerate", `window.refreshIcons()`.
- CLI: `research market-sizing | porter | swot | lean-canvas | value-prop |
  north-star`, each with `--compute` and `--provider`.
- Rust commands (`commands.rs`) + registration (`main.rs`): `market_get/_compute`,
  `porter_forces_get/_compute` (renamed to avoid the existing product-level
  `porter_get`), `swot_*`, `lean_canvas_*`, `value_prop_*`, `north_star_*`.
- `api.js`: `marketGet/marketCompute`, `porterGet/…`, `swotGet/…`,
  `leanCanvasGet/…`, `valuePropGet/…`, `northStarGet/…` (cached get + invalidating
  compute).
- `topic.js`: 6 imports, 6 tab buttons (Market · Five Forces · SWOT · Lean Canvas
  · Value Prop · North Star), 6 loader-map entries.

## Files Created

- `src/openreply/research/strategy_common.py`
- `src/openreply/research/market_sizing.py`
- `src/openreply/research/porter.py`
- `src/openreply/research/swot.py`
- `src/openreply/research/lean_canvas.py`
- `src/openreply/research/value_prop.py`
- `src/openreply/research/north_star.py`
- `app-tauri/src/screens/market.js`
- `app-tauri/src/screens/porter.js`
- `app-tauri/src/screens/swot.js`
- `app-tauri/src/screens/lean_canvas.js`
- `app-tauri/src/screens/value_prop.js`
- `app-tauri/src/screens/north_star.js`
- `docs/BUILD-PROGRESS.md` (durable cross-session tracker)

## Files Modified

- `src/openreply/cli/main.py` — 6 `research` subcommands.
- `app-tauri/src-tauri/src/commands.rs` — 12 Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — 12 api methods.
- `app-tauri/src/screens/topic.js` — imports, tab buttons, loader map.
- `FEATURES.md` — new category 17 (6 ✅), summary table now 196 · 179 ✅ · 17 🟡,
  header build-state + known-gaps rollup updated.

## Known gaps

- No MCP tools yet for the 6 frameworks (headless Claude Code can't drive them). P2.
- Each compute is a single LLM pass (no multi-round refinement). P2.
