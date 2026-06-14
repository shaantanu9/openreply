# FSD Fleet — Debate on the Topic Map + Trust Badges (Phase 0 + 1)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Brought WhyBuddy's "Multi-Agent Collaboration (FSD Fleet)" experience to the
Topic Map. The 5-persona debate engine (`deliberate()`) and persona memory
system already existed in the backend but were invisible to Map users. This
ships the plumbing + the first visible surface: a **Debate** button on the Map
toolbar that runs the 5-persona debate over a topic's cached findings, tiers each
finding (Confirmed / Probable / Minority / Discarded), persists the verdicts, and
paints **trust badges** (tier + score, evidence count, provenance, dissent flag)
on a debate panel and on the map nodes themselves. Verdicts survive reload and
go "stale" when the findings change. Spec: `docs/specs/FLEET_AGENTS_TOPIC_MAP.md`.

## Changes

- **DB (Phase 1):** new `debate_verdicts` (canonical) + `debate_runs` (audit)
  tables; denormalized `debate_tier` / `consensus_score` / `debated_at` render-
  cache columns on `graph_nodes` (lazy `ALTER` for existing installs). Helpers
  `record_debate_run`, `finish_debate_run`, `record_debate_verdict`,
  `clear_debate_verdicts`, `set_node_debate_cache`, `debate_verdicts_for_topic`.
- **Orchestrator:** `research/debate_run.py` — `run_topic_debate()` loads cached
  findings, runs `deliberate()` (heuristic fallback when no LLM key), writes one
  verdict per finding + lineage + a `debate_consensus` checks-ledger gate,
  refreshes the matching node's render cache, and returns a tier summary.
  `get_debate_verdicts()` reads verdicts and flags staleness via a findings hash.
- **Bug fix:** `deliberate.py` `_persona_vote` referenced an out-of-scope
  `persona_conclusions`, which `NameError`-crashed the entire LLM debate path
  (only `use_llm=False` worked). Threaded the parameter through.
- **CLI (Phase 0):** `research debate` and `research debate-verdicts` subcommands
  (both `--json` for the Rust wrapper).
- **Bridge (Phase 0):** Rust commands `debate_topic` / `debate_verdicts`
  (registered in `generate_handler!`); `api.debateTopic` / `api.debateVerdicts`.
- **Frontend (Phase 1):** self-contained `screens/debatePanel.js` (debate panel,
  tiers, dissent, `renderTrustBadge`); three surgical hooks into `topic.js`
  (import, toolbar Debate button + stale chip, host div + mount call); debate +
  trust-badge CSS in `style.css`.
- **Map nodes:** `graph/export.py` prepends a tier glyph (✓ ≈ ! ✕) to debated
  node labels and surfaces the verdict into node metadata — no D3 template change.

## Verification

- Python: `tests/test_debate_run.py` (4 tests — verdict write, node cache,
  lineage/checks, staleness flip, re-debate replace). Full slice e2e: debate →
  node cache → export shows glyph + verdict. Existing graph/export/brief/
  provenance tests still green.
- Rust: `cargo check` — 0 errors.
- Frontend: `npm run build` clean (1824 modules); `npm test` 52/52.

## Files Created

- `docs/specs/FLEET_AGENTS_TOPIC_MAP.md` — approved design (phases 0–3).
- `src/gapmap/research/debate_run.py` — debate orchestrator + verdict reader.
- `app-tauri/src/screens/debatePanel.js` — debate panel + trust badge module.
- `tests/test_debate_run.py` — orchestrator tests.

## Files Modified

- `src/gapmap/core/db.py` — debate tables, graph_nodes cache columns, 6 helpers, `__all__`.
- `src/gapmap/research/deliberate.py` — `_persona_vote` `persona_conclusions` fix.
- `src/gapmap/cli/main.py` — `research debate` + `research debate-verdicts` commands.
- `src/gapmap/graph/export.py` — debate glyph + verdict on exported nodes.
- `app-tauri/src-tauri/src/commands.rs` — `debate_topic` / `debate_verdicts` commands.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — `debateTopic` / `debateVerdicts`.
- `app-tauri/src/screens/topic.js` — import + toolbar button/stale chip + host + mount hook.
- `app-tauri/src/style.css` — debate panel + trust badge styles.
