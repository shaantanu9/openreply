# FSD Fleet — Flow Orchestration: decision gate, routes & staged flow (Phase 4)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Phase 4 ties the Fleet together end-to-end — the WhyBuddy "agentflow" in our
domain. A new **Run Fleet** surface on the Topic Map runs the orchestrated flow:

    decision gate → route plan (confirmation gate) → clarify → ground → debate → synthesize → audit

Each stage reuses an existing capability (no new LLM logic): clarified-brief
check, persona ingest (ground agents), `synthesize_insights`, `run_topic_debate`,
and the debate audit. A **Decision Gate** classifies the topic as simple vs
complex; **route planning** offers Quick / Standard / Deep variants with risk +
estimated cost and a recommended pick; **`run_fleet_flow`** executes the chosen
route's stages, recording a per-stage timeline to `fleet_runs` that the UI renders
(and a prior run rehydrates on tab open). Stages never crash the flow — each
returns ok/reused/skipped/attention/error, and a hard error stops the run.

## Changes

- **DB:** `fleet_runs` table (route, mode, status, per-stage `stages_json`,
  signals, cost) + helpers `record_fleet_run` / `finish_fleet_run` (commit-safe)
  / `fleet_status_for_topic`.
- **Orchestrator `research/fleet_flow.py`:** `decision_gate` (corpus/source/
  findings/brief signals), `plan_routes` (3 variants + recommendation),
  `run_fleet_flow` (staged runner with an `on_stage` streaming hook), and
  `get_fleet_status`. Stage runners wrap brief / persona ingest / insights /
  debate / audit.
- **CLI:** `research fleet-plan`, `research fleet-run` (`--route`/`--rounds`),
  `research fleet-status` (all `--json`).
- **Bridge:** Rust `fleet_plan` / `fleet_run` (600s timeout) / `fleet_status`
  (registered); `api.fleetPlan` / `fleetRun` / `fleetStatus`.
- **UI `screens/fleetFlow.js`:** Run Fleet button → decision-gate route picker
  (risk + cost + recommended) → optimistic pending timeline → final per-stage
  flow timeline with status icons; prior run rehydrates on mount. Flow styles in
  `style.css`.

## Verification

- `tests/test_fleet_flow.py` 4/4 (decision gate simple/complex, route
  recommendation, staged run with streaming callback + persistence, default
  route follows the gate). Full non-slow suite **303 passed, 0 failures**.
- `cargo check` 0 errors · `npm run build` clean · `npm test` 52/52.
- Cross-process CLI smoke: fleet-plan → fleet-run → fleet-status.

## Phase remainder

True live token streaming of the flow (stages currently update optimistically
then settle from the result; the `on_stage` hook is wired for a future NDJSON
streaming command). Debate cost remains a character-based estimate.

## Files Created

- `src/openreply/research/fleet_flow.py`
- `app-tauri/src/screens/fleetFlow.js`
- `tests/test_fleet_flow.py`

## Files Modified

- `src/openreply/core/db.py` — `fleet_runs` table + 3 helpers + `__all__`.
- `src/openreply/cli/main.py` — fleet-plan / fleet-run / fleet-status.
- `app-tauri/src-tauri/src/commands.rs` · `main.rs` — fleet commands.
- `app-tauri/src/api.js` — fleetPlan / fleetRun / fleetStatus.
- `app-tauri/src/screens/topic.js` — import + Run Fleet button + host + mount.
- `app-tauri/src/style.css` — fleet flow styles.
