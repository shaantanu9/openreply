# Agent Fleet + Debate — desktop UI + paper-merge

**Date:** 2026-06-14 · WhyBuddy port (agent fleet / debate / decision-gate / autopilot + NL command), surfacing the already-built `fleet_flow.py` + `deliberate.py` and folding papers in.

## Current state (already built, CLI-only)
- `research/fleet_flow.py`: `decision_gate`, `plan_routes`, `run_fleet_flow(topic, route, rounds, level∈L1/L2/L3, approved, on_stage)`, `get_fleet_status`, `fleet_command(directive, execute, level)` (NL decompose → per-topic missions). Stages: clarify-check → ground → synthesize → debate → audit. Persists via `db.record_fleet_run/finish_fleet_run/fleet_status_for_topic`.
- `research/deliberate.py` + `debate_run.py`: 5-persona structured debate → consensus tiers + transcript; CLI `run_topic_debate` / `get_debate_verdicts` / `get_debate_audit`.
- CLI commands exist: `research fleet-run`, `research fleet-plan`/`fleet-status`/`fleet-command`, debate commands.
- **Gaps:** no Rust/MCP/desktop UI; the flow analyzes corpus only, not papers.

## A — Surface in the desktop app
**A1 — command triangle (Rust + api):** add Tauri commands wrapping the CLI (via `run_cli`), registered in `main.rs`, exposed in `api.js`:
- `fleet_plan(topic)` → `research fleet-plan` (instant: decision-gate + routes)
- `fleet_status(topic)` → `research fleet-status`
- `fleet_command(directive, execute, level)` → `research fleet-command` (NL decompose)
- `debate_verdicts(topic)` → `get_debate_verdicts`; `debate_audit(topic)` → `get_debate_audit`
- `start_fleet_run(topic, route, level, rounds, approved)` → **streaming** via `run_cli_streaming` (reuse the collect/enrich streaming slot pattern) emitting `fleet:progress` per stage (the CLI `fleet-run` must emit NDJSON stage events via the `on_stage` hook) + `fleet:done`. (If streaming is too invasive for v1, fall back to a one-shot `run_cli` with a long timeout for L1/L2; L3 uses streaming.)
- MCP (thin): `gapmap_fleet_plan`, `gapmap_fleet_run`, `gapmap_fleet_command`, `gapmap_debate_verdicts`.

**A2 — Fleet screen** (`app-tauri/src/screens/fleet.js`, route `#/fleet` + sidebar entry):
- Decision-gate card (simple/complex + signals) + route picker (quick/standard/deep) + autopilot selector **L1 (plan only) / L2 (approve before expensive) / L3 (full)**.
- "Run fleet" → streams the **stage timeline** (clarify → ground → synthesize → debate → audit) with per-stage status/detail/cost; L2 shows an **Approve & continue** button at the takeover gate.
- **Debate panel**: consensus tiers (confirmed/contested/…) + the transcript (`debate_audit`).
- **NL Command Center**: a directive textarea → `fleet_command` → list of decomposed per-topic missions (plan or execute).

## B — Merge papers into the flow
Add a **`_stage_papers`** stage to `fleet_flow.py` (in the `deep` route, before/with synthesize) that runs the existing paper analysis (`paper_gaps` / `research_synthesis`) for the topic and ensures paper-derived academic findings are persisted as graph nodes (provenance-tagged, reuse 1A) so the **debate stage deliberates over corpus + paper findings together**. The synthesize stage's evidence should include paper chunks where available (`paper_chunk_search`). Net effect: the fleet flow "analyzes all the text" — social/web corpus **and** papers.

## Testing
- Backend: `_stage_papers` runs + records academic findings (provenance); a fleet `deep` run includes the papers stage in its timeline; `fleet_plan`/`fleet_command` JSON shapes stable.
- Wiring: Rust `cargo check`; `node --check` on fleet.js + main.js; MCP tool roundtrip.
- Manual: run a `deep` fleet flow in-app on a topic with papers → see papers stage + debate over merged findings.

## Non-fatal / compat
Every stage already swallows errors (never crashes the flow). Paper stage best-effort (skips if no papers). UI streaming reuses existing infra. Additive — no breaking changes.

## Build order
1. A1 Rust+api+MCP wiring (instant commands first: fleet_plan/status/command, debate verdicts/audit).
2. A2 Fleet screen (plan + debate panels + NL command) using the instant commands; add streaming fleet-run.
3. B `_stage_papers` + paper-evidence in synthesize; surface the papers stage in the timeline.
